import type { ReadingPanelPosition } from './models'

export const defaultReadingPanelPosition: ReadingPanelPosition = {
    anchorX: 'right',
    offsetX: 16,
    anchorY: 'bottom',
    offsetY: 16,
}

export interface ViewportSize {
    width: number
    height: number
}

export interface BoxSize {
    width: number
    height: number
}

export interface Coordinates {
    left: number
    top: number
}

export function clampFloatingCoords(
    left: number,
    top: number,
    box: BoxSize,
    viewport: ViewportSize,
    margin = 12,
): Coordinates {
    const maxLeft = Math.max(margin, viewport.width - box.width - margin)
    const maxTop = Math.max(margin, viewport.height - box.height - margin)
    return {
        left: Math.round(Math.min(Math.max(margin, left), maxLeft)),
        top: Math.round(Math.min(Math.max(margin, top), maxTop)),
    }
}

export function anchorPositionToCoords(
    position: ReadingPanelPosition,
    box: BoxSize,
    viewport: ViewportSize,
    margin = 12,
): Coordinates {
    const rawLeft =
        position.anchorX === 'left' ? position.offsetX : viewport.width - position.offsetX - box.width
    const rawTop =
        position.anchorY === 'top' ? position.offsetY : viewport.height - position.offsetY - box.height
    return clampFloatingCoords(rawLeft, rawTop, box, viewport, margin)
}

export function coordsToAnchorPosition(
    left: number,
    top: number,
    box: BoxSize,
    viewport: ViewportSize,
    margin = 12,
): ReadingPanelPosition {
    const clamped = clampFloatingCoords(left, top, box, viewport, margin)
    const distLeft = clamped.left
    const distRight = Math.max(0, viewport.width - (clamped.left + box.width))
    const distTop = clamped.top
    const distBottom = Math.max(0, viewport.height - (clamped.top + box.height))
    const anchorX = distLeft <= distRight ? 'left' : 'right'
    const anchorY = distTop <= distBottom ? 'top' : 'bottom'
    return {
        anchorX,
        offsetX: Math.round(anchorX === 'left' ? distLeft : distRight),
        anchorY,
        offsetY: Math.round(anchorY === 'top' ? distTop : distBottom),
    }
}
