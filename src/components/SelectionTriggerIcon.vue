<script setup lang="ts">
import { t } from '../i18n'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BrandLogo from './BrandLogo.vue'

const props = defineProps<{
    anchor: Range
    boundary?: HTMLElement
}>()

const emit = defineEmits<{ open: []; close: [] }>()

const button = ref<HTMLButtonElement>()
const position = ref<{ left: string; top: string }>()
const listeners = new AbortController()
const viewport = window.visualViewport
let frame = 0
const size = 26
const padding = 8
const gap = 6

function place() {
    const anchor = props.anchor
    if (!anchor.commonAncestorContainer.isConnected) {
        emit('close')
        return
    }
    const rect = anchor.getBoundingClientRect()
    const viewportLeft = viewport?.offsetLeft ?? 0
    const viewportTop = viewport?.offsetTop ?? 0
    const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth)
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
    const clip = props.boundary?.getBoundingClientRect()
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
    const minLeft = viewportLeft + padding
    const maxLeft = Math.max(minLeft, viewportRight - padding - size)
    const minTop = viewportTop + padding
    const maxTop = Math.max(minTop, viewportBottom - padding - size)
    const left = Math.min(maxLeft, Math.max(minLeft, rect.right - 8))
    const below = rect.bottom + gap
    const top = below <= maxTop ? below : Math.max(minTop, Math.min(maxTop, rect.top - size - gap))
    position.value = { left: `${left}px`, top: `${top}px` }
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
    if (button.value && path.includes(button.value)) return
    emit('close')
}

function keyboard(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    emit('close')
}

watch(
    () => props.anchor,
    () => schedule(),
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
    schedule()
})

onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    listeners.abort()
})
</script>

<template>
    <button
        ref="button"
        type="button"
        class="selection-trigger-button"
        :style="position ?? { visibility: 'hidden' }"
        :aria-label="t('card.triggerTranslate')"
        :title="t('card.triggerTranslate')"
        @pointerdown.prevent
        @click.stop="emit('open')"
    >
        <BrandLogo :size="18" />
    </button>
</template>
