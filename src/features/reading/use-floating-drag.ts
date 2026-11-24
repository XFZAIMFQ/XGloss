import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { ReadingPanelPosition } from '../../domain/models'
import {
    anchorPositionToCoords,
    clampFloatingCoords,
    coordsToAnchorPosition,
    defaultReadingPanelPosition,
    type Coordinates,
    type ViewportSize,
} from '../../domain/panel-position'
import { request } from '../../platform/messages'

const dragThresholdPx = 5
const viewportMarginPx = 12

function viewportSize(): ViewportSize {
    return {
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
    }
}

export function useFloatingDrag(
    containerRef: Ref<HTMLElement | undefined>,
    options?: { onDragStart?: () => void },
) {
    const position = ref<ReadingPanelPosition>(defaultReadingPanelPosition)
    const hasCustomPosition = ref(false)
    const coords = ref<Coordinates>()
    const dragging = ref(false)
    let suppressClick = false
    let suppressTimer: ReturnType<typeof setTimeout> | undefined
    let resizeObserver: ResizeObserver | undefined
    let dragController: AbortController | undefined
    let syncFrame = 0
    const listeners = new AbortController()

    const floatingStyle = computed(() =>
        coords.value
            ? {
                  left: `${coords.value.left}px`,
                  top: `${coords.value.top}px`,
                  right: 'auto',
                  bottom: 'auto',
              }
            : undefined,
    )

    function syncPosition() {
        const element = containerRef.value
        if (!element || dragging.value || !hasCustomPosition.value) return
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        coords.value = anchorPositionToCoords(
            position.value,
            { width: rect.width, height: rect.height },
            viewportSize(),
            viewportMarginPx,
        )
    }

    function scheduleSync() {
        if (syncFrame || !hasCustomPosition.value) return
        syncFrame = requestAnimationFrame(() => {
            syncFrame = 0
            syncPosition()
        })
    }

    function consumeSuppressedClick(): boolean {
        if (!suppressClick) return false
        suppressClick = false
        clearTimeout(suppressTimer)
        suppressTimer = undefined
        return true
    }

    function onDragPointerDown(event: PointerEvent, mode: 'trigger' | 'header') {
        if (event.button !== 0) return
        const element = containerRef.value
        if (!element) return
        if (mode === 'header') {
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest('button, a, input, select, textarea')) return
        }
        const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        const startX = event.clientX
        const startY = event.clientY
        const originLeft = rect.left
        const originTop = rect.top
        const boxWidth = rect.width
        const boxHeight = rect.height
        const pointerId = event.pointerId
        let didDrag = false
        let captured = false

        dragController?.abort()
        dragController = new AbortController()
        const signal = dragController.signal

        const finish = () => {
            dragController?.abort()
            dragController = undefined
            if (captured && handle) {
                try {
                    handle.releasePointerCapture(pointerId)
                } catch {
                    // Pointer capture may already be released by the browser.
                }
            }
            if (!didDrag) return
            dragging.value = false
            const finalRect = element.getBoundingClientRect()
            const currentCoords = coords.value ?? { left: originLeft, top: originTop }
            const saved = coordsToAnchorPosition(
                currentCoords.left,
                currentCoords.top,
                { width: finalRect.width || boxWidth, height: finalRect.height || boxHeight },
                viewportSize(),
                viewportMarginPx,
            )
            position.value = saved
            hasCustomPosition.value = true
            coords.value = anchorPositionToCoords(
                saved,
                { width: finalRect.width || boxWidth, height: finalRect.height || boxHeight },
                viewportSize(),
                viewportMarginPx,
            )
            void request('saveReadingPanelPosition', saved).catch(() => undefined)
            suppressClick = true
            clearTimeout(suppressTimer)
            suppressTimer = setTimeout(() => {
                suppressClick = false
                suppressTimer = undefined
            }, 80)
        }

        window.addEventListener(
            'pointermove',
            (moveEvent) => {
                if (moveEvent.pointerId !== pointerId) return
                const dx = moveEvent.clientX - startX
                const dy = moveEvent.clientY - startY
                if (!didDrag) {
                    if (Math.hypot(dx, dy) < dragThresholdPx) return
                    didDrag = true
                    dragging.value = true
                    options?.onDragStart?.()
                    window.getSelection()?.removeAllRanges()
                    if (handle) {
                        try {
                            handle.setPointerCapture(pointerId)
                            captured = true
                        } catch {
                            captured = false
                        }
                    }
                }
                moveEvent.preventDefault()
                coords.value = clampFloatingCoords(
                    originLeft + dx,
                    originTop + dy,
                    { width: boxWidth, height: boxHeight },
                    viewportSize(),
                    viewportMarginPx,
                )
            },
            { signal },
        )
        window.addEventListener(
            'pointerup',
            (upEvent) => {
                if (upEvent.pointerId === pointerId) finish()
            },
            { signal },
        )
        window.addEventListener(
            'pointercancel',
            (cancelEvent) => {
                if (cancelEvent.pointerId === pointerId) finish()
            },
            { signal },
        )
    }

    onMounted(() => {
        const signal = listeners.signal
        window.addEventListener('resize', scheduleSync, { passive: true, signal })
        window.visualViewport?.addEventListener('resize', scheduleSync, { passive: true, signal })
        resizeObserver = new ResizeObserver(scheduleSync)
        if (containerRef.value) resizeObserver.observe(containerRef.value)
        void request('readingPanelPosition')
            .then((saved) => {
                if (!saved || signal.aborted) return
                position.value = saved
                hasCustomPosition.value = true
                syncPosition()
            })
            .catch(() => undefined)
    })

    onBeforeUnmount(() => {
        listeners.abort()
        dragController?.abort()
        resizeObserver?.disconnect()
        cancelAnimationFrame(syncFrame)
        clearTimeout(suppressTimer)
    })

    return {
        dragging,
        floatingStyle,
        onDragPointerDown,
        consumeSuppressedClick,
        syncPosition,
    }
}
