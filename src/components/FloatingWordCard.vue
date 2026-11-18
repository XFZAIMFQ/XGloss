<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { WordRating, WordSource } from '../domain/models'
import WordCard from './WordCard.vue'

const props = defineProps<{
    text: string
    source: WordSource
    rating: WordRating | undefined
    anchor: HTMLElement | Range
    boundary: HTMLElement | undefined
    spotlight: { enabled: boolean; setEnabled: (enabled: boolean) => void | Promise<void> }
}>()
const emit = defineEmits<{ saved: []; close: [] }>()
const card = ref<HTMLElement>()
const position = ref<{ left: string; top: string; maxHeight: string }>()
const listeners = new AbortController()
const viewport = window.visualViewport
let anchorListeners: AbortController | undefined
let observer: ResizeObserver | undefined
let frame = 0
const padding = 10
const gap = 8

function place() {
    const element = card.value
    if (!element) return
    const anchor = props.anchor
    if (!(anchor instanceof HTMLElement ? anchor.isConnected : anchor.commonAncestorContainer.isConnected)) {
        emit('close')
        return
    }
    const rect = anchor.getBoundingClientRect()
    const viewportLeft = viewport?.offsetLeft ?? 0
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth)
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
    const boundary =
        props.boundary ?? (anchor instanceof HTMLElement ? anchor.closest('.candidate-list') : null)
    const clip = boundary?.getBoundingClientRect()
    if (
        !rect.height ||
        rect.bottom <= Math.max(viewportTop, clip?.top ?? viewportTop) ||
        rect.top >= Math.min(viewportBottom, clip?.bottom ?? viewportBottom) ||
        rect.right < Math.max(viewportLeft, clip?.left ?? viewportLeft) ||
        rect.left > Math.min(viewportRight, clip?.right ?? viewportRight)
    ) {
        emit('close')
        return
    }

    const left = viewportLeft + padding
    const top = viewportTop + padding
    const right = viewportRight - padding
    const bottom = viewportBottom - padding
    const maxWidth = `${Math.max(0, right - left)}px`
    if (element.style.maxWidth !== maxWidth) element.style.maxWidth = maxWidth
    const box = element.getBoundingClientRect()
    const content = element.querySelector('.word-card-content')
    const maxHeight = Math.min(400, bottom - top)
    const desiredHeight = Math.min(
        maxHeight,
        box.height + (content ? content.scrollHeight - content.clientHeight : 0),
    )
    const before = rect.left - gap - box.width
    const after = rect.right + gap
    const beside = anchor instanceof HTMLElement && (before >= left || after + box.width <= right)
    let x = rect.left
    let y: number
    let height: number
    if (beside) {
        x = before >= left ? before : after
        height = maxHeight
        y = Math.min(Math.max(top, rect.top), bottom - Math.min(box.height, height))
    } else {
        // Measure the unscrolled content when picking a side so an expanded definition cannot flip back and forth.
        const below = bottom - rect.bottom - gap
        const above = rect.top - gap - top
        const useBelow = below >= desiredHeight || below >= above
        height = Math.min(maxHeight, useBelow ? below : above)
        y = useBelow ? rect.bottom + gap : rect.top - gap - Math.min(box.height, height)
    }
    if (height <= 0) {
        emit('close')
        return
    }
    position.value = {
        left: `${Math.max(left, Math.min(x, right - box.width))}px`,
        top: `${Math.max(top, y)}px`,
        maxHeight: `${height}px`,
    }
}

function schedule() {
    if (frame) return
    frame = requestAnimationFrame(() => {
        frame = 0
        place()
    })
}

function outside(event: PointerEvent) {
    const path = event.composedPath()
    if (card.value && path.includes(card.value)) return
    if (props.anchor instanceof HTMLElement && path.includes(props.anchor)) return
    emit('close')
}

function close() {
    if (props.anchor instanceof HTMLElement) props.anchor.focus({ preventScroll: true })
    emit('close')
}

function keyboard(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    close()
}

watch(
    () => props.anchor,
    (anchor) => {
        anchorListeners?.abort()
        if (anchor instanceof HTMLElement) {
            anchorListeners = new AbortController()
            anchor
                .getRootNode()
                .addEventListener('scroll', schedule, { capture: true, signal: anchorListeners.signal })
        }
        schedule()
    },
    { immediate: true },
)

onMounted(() => {
    const signal = listeners.signal
    window.addEventListener('scroll', schedule, { capture: true, passive: true, signal })
    window.addEventListener('resize', schedule, { passive: true, signal })
    viewport?.addEventListener('resize', schedule, { passive: true, signal })
    viewport?.addEventListener('scroll', schedule, { passive: true, signal })
    document.addEventListener('pointerdown', outside, { capture: true, signal })
    document.addEventListener('keydown', keyboard, { capture: true, signal })
    observer = new ResizeObserver(schedule)
    if (card.value) observer.observe(card.value)
    schedule()
})

onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    observer?.disconnect()
    anchorListeners?.abort()
    listeners.abort()
})
</script>

<template>
    <div ref="card" class="floating-card" :style="position ?? { visibility: 'hidden' }">
        <WordCard
            :text="text"
            :source="source"
            :rating="rating"
            :spotlight="spotlight"
            @saved="emit('saved')"
            @close="close"
        />
    </div>
</template>
