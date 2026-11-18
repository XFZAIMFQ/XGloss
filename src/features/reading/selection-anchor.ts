export function selectionAnchor(selection: Selection): Range {
    const range = selection.getRangeAt(0).cloneRange()
    const atStart =
        range.startContainer === selection.focusNode && range.startOffset === selection.focusOffset
    range.collapse(atStart)
    return range.getBoundingClientRect().height ? range : selection.getRangeAt(0).cloneRange()
}
