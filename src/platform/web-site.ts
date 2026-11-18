export function webHostname(url: string | undefined): string | undefined {
    if (!url || !URL.canParse(url)) return
    const page = new URL(url)
    if (!['http:', 'https:'].includes(page.protocol) || !page.hostname) return
    if (
        page.hostname === 'chromewebstore.google.com' ||
        (page.hostname === 'chrome.google.com' && page.pathname.startsWith('/webstore'))
    )
        return
    return page.hostname
}
