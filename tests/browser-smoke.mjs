import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

function makePdf(pages) {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    const children = []
    for (let index = 0; index < pages; index++) {
        const pageId = objects.length + 1
        const contentId = pageId + 1
        children.push(`${pageId} 0 R`)
        objects.push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
        )
        const stream = `BT /F1 18 Tf 50 700 Td (Hardware register learning vocabulary page ${index + 1}) Tj ET`
        objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
    }
    objects[1] = `<< /Type /Pages /Kids [${children.join(' ')}] /Count ${pages} >>`
    const outlines = objects.length + 1
    objects[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlines} 0 R >>`
    objects.push(`<< /Type /Outlines /First ${outlines + 1} 0 R /Last ${outlines + 1} 0 R /Count 1 >>`)
    objects.push(
        `<< /Title (DMA reference) /Parent ${outlines} 0 R /Dest [${children[2] ?? children[0]} /Fit] >>`,
    )
    let output = '%PDF-1.4\n'
    const offsets = [0]
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(output))
        output += `${index + 1} 0 obj\n${object}\nendobj\n`
    }
    const xref = Buffer.byteLength(output)
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    return Buffer.from(output)
}

const pdf = makePdf(300)
let translationRequests = 0
let activePanelRequests = 0
let peakPanelRequests = 0
const translationInputs = []
const fixtureSentence = 'Hardware register learning vocabulary and embedded firmware documentation.'
const server = createServer((request, response) => {
    if (request.url === '/v1/chat/completions') {
        translationRequests++
        let data = ''
        request.on('data', (chunk) => {
            data += chunk
        })
        request.on('end', () => {
            const payload = JSON.parse(data)
            assert.equal(payload.model, 'smoke-model')
            const input = JSON.parse(payload.messages[1].content)
            translationInputs.push({ ...input, system: payload.messages[0].content })
            if (input.selectedText === 'package') {
                response.writeHead(503).end()
                return
            }
            const result = /\s/.test(input.selectedText)
                ? { kind: 'text', text: '这是完整的选区译文\u3002' }
                : {
                      kind: 'meanings',
                      meanings: [
                          { text: '寄存器', partOfSpeech: '名词' },
                          { text: '登记', partOfSpeech: '动词' },
                      ],
                  }
            const respond = () => {
                response.setHeader('Content-Type', 'application/json')
                response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }))
            }
            if (input.context === fixtureSentence && !/\s/.test(input.selectedText)) {
                activePanelRequests++
                peakPanelRequests = Math.max(peakPanelRequests, activePanelRequests)
                const timer = setTimeout(respond, 400)
                response.once('close', () => {
                    clearTimeout(timer)
                    activePanelRequests--
                })
            } else if (input.selectedText === 'cacheprobe') setTimeout(respond, 400)
            else respond()
        })
    } else if (request.url === '/sample.pdf') {
        response.setHeader('Content-Type', 'application/pdf')
        response.end(pdf)
    } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(
            '<!doctype html><title>Long technical document</title>' +
                '<header><span id="edge-word" style="position:fixed;bottom:26px;left:24px">package</span></header><main>' +
                '<p>Hardware <em id="inline-register">register</em> learning vocabulary and embedded firmware documentation.</p>' +
                '<p>Hardware register learning vocabulary and embedded firmware documentation.</p>'.repeat(
                    1999,
                ) +
                '</main>',
        )
    }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const directory = resolve(`.cache/smoke-${Date.now()}`)
await mkdir(directory, { recursive: true })
const extensionPath = resolve(directory, 'extension')
await cp(resolve('.output/chrome-mv3'), extensionPath, { recursive: true })
const manifestPath = resolve(extensionPath, 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
// The isolated test copy pregrants only our fixture server for headless execution.
manifest.host_permissions = ['http://127.0.0.1/*']
await writeFile(manifestPath, JSON.stringify(manifest))
const context = await chromium.launchPersistentContext(resolve(directory, 'profile'), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--host-resolver-rules=MAP xgloss-test.test 127.0.0.1',
        '--no-proxy-server',
    ],
})
const errors = []
context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)))
try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    const id = new URL(worker.url()).host
    const options = await context.newPage()
    await options.goto(`chrome-extension://${id}/options.html`)
    await options.getByRole('button', { name: '使用 DeepSeek 预设' }).click()
    assert.equal(
        await options.getByPlaceholder('https://api.example.com/v1').inputValue(),
        'https://api.deepseek.com',
    )
    assert.equal(await options.getByPlaceholder('填写服务支持的模型 ID').inputValue(), 'deepseek-flash')
    await options.getByPlaceholder('https://api.example.com/v1').fill(`${origin}/v1`)
    await options.getByPlaceholder('填写服务支持的模型 ID').fill('smoke-model')
    await options.locator('.modal').getByRole('button', { name: '测试语境翻译' }).click()
    await options.getByText('寄存器 / 登记', { exact: true }).waitFor()
    assert.equal(translationRequests, 1)
    await options.locator('.provider-card').getByRole('button', { name: '测试语境翻译' }).click()
    await options.getByText('寄存器 / 登记', { exact: true }).waitFor()
    assert.equal(translationRequests, 1, 'Identical translation should use the local cache')
    await options.getByRole('button', { name: '添加翻译来源' }).click()
    await options.getByLabel('来源名称').fill('Backup LLM')
    await options.getByPlaceholder('https://api.example.com/v1').fill(`${origin}/v1`)
    await options.getByPlaceholder('填写服务支持的模型 ID').fill('smoke-model')
    await options.getByRole('button', { name: '保存并授权' }).click()
    const deepSeekCard = options.locator('.provider-card').filter({ hasText: 'DeepSeek' })
    const backupCard = options.locator('.provider-card').filter({ hasText: 'Backup LLM' })
    await backupCard.getByText('当前启用', { exact: true }).waitFor()
    await deepSeekCard.getByRole('button', { name: '设为当前' }).click()
    await deepSeekCard.getByText('当前启用', { exact: true }).waitFor()
    await backupCard.getByRole('button', { name: '删除来源' }).click()
    await options.locator('.modal').getByRole('button', { name: '删除来源' }).click()
    await backupCard.waitFor({ state: 'detached' })
    const settingsNav = options.getByRole('navigation', { name: '设置分类导航' })
    await settingsNav.getByRole('button', { name: '通用与词卡' }).click()
    await options.getByRole('combobox', { name: '默认释义' }).click()
    await options.getByRole('option', { name: '详细 (词性和原句)' }).click()
    await options.getByText('词卡显示偏好已保存', { exact: true }).waitFor()
    await options.getByRole('combobox', { name: '默认释义' }).click()
    await options.getByRole('option', { name: '简洁' }).click()
    await options.getByText('词卡显示偏好已保存', { exact: true }).waitFor()
    const concurrent = await options.evaluate(async () => {
        const translate = () =>
            chrome.runtime.sendMessage({
                channel: 'xgloss',
                operation: 'translate',
                input: { text: 'cacheprobe', context: 'Concurrent lookups.' },
                requestId: crypto.randomUUID(),
            })
        return Promise.all([translate(), translate()])
    })
    assert.ok(concurrent.every((result) => result.ok))
    assert.equal(translationInputs.filter(({ selectedText }) => selectedText === 'cacheprobe').length, 1)

    await worker.evaluate(() => chrome.storage.local.set({ 'spotlight:127.0.0.1': false }))
    const article = await context.newPage()
    await article.goto(origin + '/article')
    const articleTab = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
        origin + '/article',
    )
    const badge = article.getByRole('button', { name: /^展开阅读面板/ })
    await article.waitForFunction(
        () =>
            document.querySelector('#xgloss-root')?.shadowRoot?.querySelector('.reading-trigger strong')
                ?.textContent === '0%',
    )
    const badgeBox = await badge.boundingBox()
    assert.ok(badgeBox.width <= 65 && badgeBox.height <= 36, 'Resting badge shows only a small percentage')
    await badge.hover()
    await article.waitForFunction(
        ({ width, right }) => {
            const box = document
                .querySelector('#xgloss-root')
                ?.shadowRoot?.querySelector('.reading-trigger')
                ?.getBoundingClientRect()
            return box && box.width >= width + 90 && Math.abs(box.right - right) < 2
        },
        { width: badgeBox.width, right: badgeBox.x + badgeBox.width },
    )
    assert.equal(await article.locator('.reading-panel').count(), 0)
    await article.mouse.move(20, 20)
    await article.waitForFunction(
        () =>
            document
                .querySelector('#xgloss-root')
                ?.shadowRoot?.querySelector('.reading-trigger')
                ?.getBoundingClientRect().width < 65,
    )
    await badge.focus()
    await badge.press('Enter')
    const readingPanel = article.locator('.reading-panel')
    const spotlight = readingPanel.getByRole('button', { name: 'Spotlight 正文高亮' })
    await readingPanel.getByRole('button', { name: 'Spotlight 正文高亮', pressed: true }).waitFor()
    await spotlight.click()
    await article.waitForFunction(() =>
        [...CSS.highlights.values()].every((highlight) => highlight.size === 0),
    )
    assert.equal(await spotlight.getAttribute('aria-pressed'), 'false')
    assert.equal(await readingPanel.locator('.statistics dd').first().textContent(), '16,000')
    assert.ok((await readingPanel.boundingBox()).height <= 480, 'Panel height is capped')
    assert.equal(await article.evaluate(() => document.querySelectorAll('p').length), 2000)

    const recall = readingPanel.getByRole('button', { name: '回想模式', exact: true })
    const registerRow = readingPanel.locator('.candidate-item').filter({ hasText: 'register' })
    const offscreen = await readingPanel
        .locator('.candidate-list')
        .evaluate((list) =>
            [...list.querySelectorAll('[data-word]')]
                .filter((row) => row.getBoundingClientRect().top > list.getBoundingClientRect().bottom)
                .map((row) => row.dataset.word),
        )
    assert.ok(
        !translationInputs.some(
            ({ selectedText, context }) => context === fixtureSentence && offscreen.includes(selectedText),
        ),
    )
    await registerRow.scrollIntoViewIfNeeded()
    const preview = registerRow.locator('.candidate-meaning')
    await preview.filter({ hasText: /^\s*寄存器\s*$/ }).waitFor()
    assert.equal((await preview.textContent()).trim(), '寄存器')
    assert.equal(peakPanelRequests, 5, 'Visible rows should use five parallel fixture requests')
    const registerRequests = () =>
        translationInputs.filter(
            ({ selectedText, context }) => selectedText === 'register' && context === fixtureSentence,
        ).length
    assert.equal(registerRequests(), 1)
    await recall.click()
    await readingPanel.getByRole('button', { name: '回想模式', pressed: true }).waitFor()
    assert.equal(await readingPanel.locator('.candidate-meaning').count(), 0)
    await readingPanel.getByRole('button', { name: '显示 register 的释义' }).press('Enter')
    await registerRow.locator('.candidate-meaning').filter({ hasText: '寄存器' }).waitFor()
    assert.equal(await readingPanel.locator('.candidate-meaning').count(), 1)
    assert.equal(await article.locator('.word-card').count(), 0)

    await article.getByRole('button', { name: 'register ×2000' }).click()
    const card = article.locator('.word-card')
    await card.locator('.meaning-option').last().waitFor()
    assert.deepEqual(await card.locator('.meaning-option > span:first-child').allTextContents(), [
        '寄存器',
        '登记',
    ])
    assert.equal(registerRequests(), 1, 'The panel and card share the same context cache')
    const preferredMeaning = card.getByRole('button', { name: '寄存器', exact: true })
    const contextMatch = preferredMeaning.locator('.context-match[title="语境首选"]')
    const contextDescription = card.locator('span[hidden]').filter({ hasText: /^语境首选$/ })
    await contextMatch.waitFor()
    assert.equal(await preferredMeaning.getAttribute('aria-pressed'), 'true')
    assert.equal(
        await preferredMeaning.getAttribute('aria-describedby'),
        await contextDescription.getAttribute('id'),
    )
    assert.equal(await card.getByText('名词', { exact: true }).count(), 0)
    await card.getByRole('button', { name: 'Spotlight 正文高亮', pressed: false }).click()
    await readingPanel.getByRole('button', { name: 'Spotlight 正文高亮', pressed: true }).waitFor()
    await article.waitForFunction(() => (CSS.highlights.get('xgloss-unknown')?.size ?? 0) > 0)
    await card.getByRole('button', { name: '登记', exact: true }).click()
    await card.getByRole('button', { name: '登记', exact: true, pressed: true }).waitFor()
    assert.equal(await preferredMeaning.getAttribute('aria-pressed'), 'false')
    assert.equal(
        await preferredMeaning.getAttribute('aria-describedby'),
        await contextDescription.getAttribute('id'),
    )
    await card.getByRole('button', { name: '学习 2 级 (初识) - register', exact: true }).click()
    await card.getByText('已保存 - 学习 2 级 (初识)', { exact: true }).waitFor()
    await article.waitForFunction(() => (CSS.highlights.get('xgloss-learning-2')?.size ?? 0) > 0)
    const requestsBeforeMode = registerRequests()
    await card.getByRole('button', { name: '详细释义', exact: true }).click()
    await card.locator('blockquote').waitFor()
    await card.getByText('名词', { exact: true }).waitFor()
    await card.getByRole('button', { name: '简洁释义', exact: true }).click()
    assert.equal(registerRequests(), requestsBeforeMode)
    await article.locator('.word-card').screenshot({ path: resolve(directory, 'word-card.png') })
    await article.keyboard.press('Escape')
    await article.getByRole('button', { name: 'register ×2000' }).click()
    await card.getByRole('button', { name: '登记', exact: true, pressed: true }).waitFor()
    assert.equal(registerRequests(), 1)
    await card.getByRole('button', { name: '翻译方向', exact: true }).click()
    await card.getByRole('combobox', { name: '目标语言', exact: true }).click()
    const selectStyleMetrics = await article.evaluate(() => {
        const shadow = document.querySelector('#xgloss-root')?.shadowRoot
        const menu = shadow?.querySelector('.shadcn-select-menu')
        const trigger = shadow?.querySelector('.shadcn-select-trigger')
        if (!menu || !trigger) return null
        return {
            position: getComputedStyle(menu).position,
            triggerHeight: trigger.getBoundingClientRect().height,
            triggerWidth: trigger.getBoundingClientRect().width,
        }
    })
    assert.ok(selectStyleMetrics, 'ShadcnSelect menu and trigger should render inside WordCard Shadow DOM')
    assert.equal(selectStyleMetrics.position, 'absolute')
    assert.ok(selectStyleMetrics.triggerHeight <= 30 && selectStyleMetrics.triggerWidth >= 180)
    const cardBox = await article.locator('.floating-card').boundingBox()
    if (cardBox) {
        await article.screenshot({
            path: resolve(directory, 'word-card-lang-open.png'),
            clip: {
                x: Math.max(0, Math.floor(cardBox.x - 16)),
                y: Math.max(0, Math.floor(cardBox.y - 40)),
                width: Math.min(
                    1440 - Math.max(0, Math.floor(cardBox.x - 16)),
                    Math.ceil(cardBox.width + 32),
                ),
                height: Math.min(
                    1000 - Math.max(0, Math.floor(cardBox.y - 40)),
                    Math.ceil(cardBox.height + 280),
                ),
            },
        })
    }
    await card.getByRole('option', { name: '英语', exact: true }).click()
    await article.waitForFunction(() =>
        document
            .querySelector('#xgloss-root')
            ?.shadowRoot?.querySelector('.lang-capsule-button')
            ?.textContent?.includes('EN'),
    )
    assert.ok(translationInputs.at(-1)?.system.includes('Write in English.'))
    const globalLanguages = await options.evaluate(() =>
        chrome.runtime.sendMessage({
            channel: 'xgloss',
            operation: 'translationLanguages',
            requestId: crypto.randomUUID(),
        }),
    )
    assert.deepEqual(globalLanguages.value, { sourceLanguage: 'auto', targetLanguage: '简体中文' })
    await article.keyboard.press('Escape')
    await card.getByRole('dialog', { name: '翻译方向' }).waitFor({ state: 'detached' })
    await card.waitFor({ state: 'visible' })
    await article.keyboard.press('Escape')
    await recall.click()
    await readingPanel.getByRole('button', { name: '回想模式', pressed: false }).waitFor()
    await registerRow.locator('.candidate-meaning').waitFor()
    const row = readingPanel
        .locator('.candidate-item')
        .filter({ has: article.getByRole('button', { name: 'register ×2000' }) })
    const firstLevel = row.getByRole('button', { name: '学习 1 级 (新词) - register' })
    const secondLevel = row.getByRole('button', { name: '学习 2 级 (初识) - register' })
    await firstLevel.scrollIntoViewIfNeeded()
    const currentScroll = await readingPanel
        .locator('.candidate-list')
        .evaluate((element) => element.scrollTop)
    await firstLevel.click()
    await row.locator('button[aria-pressed="true"][aria-label="学习 1 级 (新词) - register"]').waitFor()
    await secondLevel.click()
    await row.locator('button[aria-pressed="true"][aria-label="学习 2 级 (初识) - register"]').waitFor()
    assert.equal(
        await readingPanel.locator('.candidate-list').evaluate((element) => element.scrollTop),
        currentScroll,
    )
    await readingPanel.getByRole('button', { name: '收起面板' }).click()
    await badge.click()
    await row.getByRole('button', { name: 'register ×2000' }).waitFor()
    assert.equal(
        await readingPanel.locator('.candidate-list').evaluate((element) => element.scrollTop),
        currentScroll,
        'Reopening restores the batch and its scroll offset',
    )
    await readingPanel.screenshot({ path: resolve(directory, 'reading-panel.png') })
    await readingPanel.getByRole('button', { name: '刷新词表' }).click()
    await row.waitFor({ state: 'detached' })

    await readingPanel.getByRole('button', { name: '收起面板' }).click()
    await article.locator('#edge-word').evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }))
    })
    await card.getByRole('alert').filter({ hasText: 'HTTP 503' }).waitFor()
    await card.getByRole('button', { name: '重试翻译' }).waitFor()
    await article.waitForFunction(() => {
        const edge = document.querySelector('#edge-word')?.getBoundingClientRect()
        const popup = document
            .querySelector('#xgloss-root')
            ?.shadowRoot?.querySelector('.floating-card')
            ?.getBoundingClientRect()
        return edge && popup && popup.bottom < edge.top && popup.left >= 9 && popup.height <= 195
    })
    await article.setViewportSize({ width: 390, height: 844 })
    await article.waitForFunction(() => {
        const popup = document
            .querySelector('#xgloss-root')
            ?.shadowRoot?.querySelector('.floating-card')
            ?.getBoundingClientRect()
        return popup && popup.right <= innerWidth - 8 && popup.left >= 8 && popup.top >= 8
    })
    await card.screenshot({ path: resolve(directory, 'word-card-mobile.png') })
    await article.mouse.click(380, 100)
    await card.waitFor({ state: 'detached' })
    await article.setViewportSize({ width: 1440, height: 1000 })
    await article.locator('#inline-register').evaluate((element) => {
        const text = element.parentElement.lastChild
        const range = document.createRange()
        range.setStart(element.parentElement.firstChild, 0)
        range.setEnd(text, text.length)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }))
    })
    await card.getByText('这是完整的选区译文.', { exact: true }).waitFor()
    assert.equal(await card.locator('.word-rating-controls').count(), 0)
    assert.ok(
        translationInputs.some(
            ({ selectedText, context }) => selectedText === fixtureSentence && context === fixtureSentence,
        ),
    )
    await article.keyboard.press('Escape')
    await badge.click()
    await article.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const ranges = await article.evaluate(() =>
        [...CSS.highlights.values()].reduce((count, highlight) => count + highlight.size, 0),
    )
    assert.ok(ranges <= 5000)
    const accessChecks = await worker.evaluate(
        (tabId) =>
            chrome.scripting.executeScript({
                target: { tabId },
                func: async () => {
                    const settings = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'settings',
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedChange = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'setSiteAnalysis',
                        input: { tabId: 1, site: location.hostname, enabled: false },
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedTrigger = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'setSelectionTrigger',
                        input: 'off',
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedScope = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'setWebAnalysisScope',
                        input: 'full',
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedLangs = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'setTranslationLanguages',
                        input: { sourceLanguage: 'ja', targetLanguage: 'English' },
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedActive = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'activeCollection',
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedSetActive = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'setActiveCollection',
                        input: 'en',
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedProviders = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'translationProviders',
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedWordbooks = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'wordbookProfiles',
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedGoogleSync = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'googleSyncState',
                        requestId: crypto.randomUUID(),
                    })
                    const attemptedDeleteWords = await chrome.runtime.sendMessage({
                        channel: 'xgloss',
                        operation: 'deleteWords',
                        input: ['register'],
                        requestId: crypto.randomUUID(),
                    })
                    return {
                        settings: settings.ok,
                        siteAnalysis: attemptedChange.ok,
                        setSelectionTrigger: attemptedTrigger.ok,
                        setWebAnalysisScope: attemptedScope.ok,
                        setTranslationLanguages: attemptedLangs.ok,
                        activeCollection: attemptedActive.ok,
                        setActiveCollection: attemptedSetActive.ok,
                        translationProviders: attemptedProviders.ok,
                        wordbookProfiles: attemptedWordbooks.ok,
                        googleSyncState: attemptedGoogleSync.ok,
                        deleteWords: attemptedDeleteWords.ok,
                    }
                },
            }),
        articleTab,
    )
    assert.deepEqual(accessChecks[0].result, {
        settings: false,
        siteAnalysis: false,
        setSelectionTrigger: false,
        setWebAnalysisScope: false,
        setTranslationLanguages: false,
        activeCollection: false,
        setActiveCollection: false,
        translationProviders: false,
        wordbookProfiles: false,
        googleSyncState: false,
        deleteWords: false,
    })
    await article.evaluate(() => document.querySelector('main').firstElementChild.remove())
    await article.waitForFunction(
        () =>
            document.querySelector('#xgloss-root')?.shadowRoot?.querySelector('.statistics dd')
                ?.textContent === '15,992',
    )
    // Verify SPA route navigation that replaces the entire <main> element triggers fresh analysis.
    await article.evaluate(() => {
        history.pushState({}, '', '/docs/learn_the_basics')
        const nextMain = document.createElement('main')
        nextMain.innerHTML = '<p>Embedded display driver framebuffer rendering tutorial.</p>'
        document.querySelector('main').replaceWith(nextMain)
    })
    await readingPanel.waitFor({ state: 'detached' })
    await badge.click()
    await article.waitForFunction(
        () =>
            document.querySelector('#xgloss-root')?.shadowRoot?.querySelector('.statistics dd')
                ?.textContent === '6',
    )
    await readingPanel.locator('.candidate-item').filter({ hasText: 'framebuffer' }).waitFor()
    // Verify webAnalysisScope='full' includes <header>/<nav> elements outside <main> in real time.
    await options.getByRole('combobox', { name: '网页识别范围' }).click()
    await options.getByRole('option', { name: '整页内容 (含导航与侧栏)' }).click()
    await options.getByText('网页识别范围已保存', { exact: true }).waitFor()
    await article.waitForFunction(
        () =>
            document.querySelector('#xgloss-root')?.shadowRoot?.querySelector('.statistics dd')
                ?.textContent === '7',
    )
    await options.getByRole('combobox', { name: '网页识别范围' }).click()
    await options.getByRole('option', { name: '仅正文区域 (默认)' }).click()
    await options.getByText('网页识别范围已保存', { exact: true }).waitFor()
    await article.waitForFunction(
        () =>
            document.querySelector('#xgloss-root')?.shadowRoot?.querySelector('.statistics dd')
                ?.textContent === '6',
    )
    const otherSite = await context.newPage()
    await otherSite.goto(origin.replace('127.0.0.1', 'xgloss-test.test') + '/article')
    assert.equal(await otherSite.evaluate(() => window.isSecureContext), false)
    const otherBadge = otherSite.getByRole('button', { name: /^展开阅读面板/ })
    await otherBadge.click()
    await otherSite.getByRole('button', { name: 'Spotlight 正文高亮', pressed: true }).waitFor()
    await article.bringToFront()
    await spotlight.click()
    await readingPanel.getByRole('button', { name: 'Spotlight 正文高亮', pressed: false }).waitFor()
    await otherSite.getByRole('button', { name: 'Spotlight 正文高亮', pressed: false }).waitFor()
    assert.equal(await otherSite.locator('.statistics dd').first().textContent(), '16,000')
    await recall.click()
    await otherSite.getByRole('button', { name: '回想模式', pressed: true }).waitFor()

    async function setSiteAnalysis(enabled) {
        const result = await options.evaluate(
            ({ enabled, tabId }) =>
                chrome.runtime.sendMessage({
                    channel: 'xgloss',
                    operation: 'setSiteAnalysis',
                    input: { tabId, site: '127.0.0.1', enabled },
                    requestId: crypto.randomUUID(),
                }),
            { enabled, tabId: articleTab },
        )
        assert.equal(result.ok, true, result.error)
    }
    await setSiteAnalysis(false)
    await article.locator('#xgloss-root').waitFor({ state: 'detached' })
    assert.equal(await article.evaluate(() => CSS.highlights.size), 0)
    await otherSite.getByRole('button', { name: 'Spotlight 正文高亮', pressed: false }).waitFor()
    await article.reload()
    await options.waitForFunction(async (tabId) => {
        try {
            return (await chrome.tabs.sendMessage(tabId, { event: 'siteReadingPing' })) === true
        } catch {
            return false
        }
    }, articleTab)
    assert.equal(await article.locator('#xgloss-root').count(), 0, 'Disabled site stays disabled on reload')
    await setSiteAnalysis(true)
    await badge.click()
    await readingPanel.getByRole('button', { name: 'Spotlight 正文高亮', pressed: false }).waitFor()
    await readingPanel.getByRole('button', { name: '回想模式', pressed: true }).waitFor()
    assert.equal(await readingPanel.locator('.candidate-meaning').count(), 0)
    await recall.click()
    await readingPanel.getByRole('button', { name: '回想模式', pressed: false }).waitFor()

    const library = await context.newPage()
    await library.goto(`chrome-extension://${id}/library.html`)
    await library.getByRole('button', { name: '添加词库' }).click()
    await library.getByRole('button', { name: '日语' }).click()
    await library.getByLabel('词库名称').fill('日语测试词库')
    await library.getByLabel('词库注释').fill('日文文章收藏')
    await library.getByRole('button', { name: '保存词库' }).click()
    await library.getByRole('button', { name: '打开词库 - 日语测试词库' }).waitFor()
    const jaCard = library.locator('.collection-card').filter({ hasText: '日语测试词库' })
    await jaCard.getByRole('button', { name: '编辑词库' }).click()
    await library.getByLabel('词库名称').fill('N1 核心词库')
    await library.getByRole('button', { name: '保存词库' }).click()
    await library.getByRole('button', { name: '打开词库 - N1 核心词库' }).waitFor()
    const editedJaCard = library.locator('.collection-card').filter({ hasText: 'N1 核心词库' })
    await editedJaCard.getByRole('button', { name: '置顶词库' }).click()
    await editedJaCard.getByRole('button', { name: '取消置顶', pressed: true }).waitFor()
    await library.getByRole('button', { name: '打开词库 - 阅读收藏' }).click()
    assert.ok(
        await library.locator('.library-toolbar').evaluate((toolbar) => {
            const controls = [...toolbar.querySelectorAll('button[role="combobox"], input')]
            return (
                controls[0]?.getAttribute('role') === 'combobox' &&
                controls[1]?.getAttribute('role') === 'combobox' &&
                controls[2]?.tagName === 'INPUT'
            )
        }),
        'Category filter and sort dropdown must be placed to the left of the search input',
    )
    await library.getByRole('button', { name: '添加单词' }).click()
    await library.getByLabel('单词或短语').fill('alpha')
    await library.getByRole('button', { name: '加入生词' }).click()
    await library.getByRole('button', { name: '添加单词' }).click()
    await library.getByLabel('单词或短语').fill('zebra')
    await library.getByRole('button', { name: '加入生词' }).click()
    await library.getByRole('combobox', { name: '排序方式' }).click()
    await library.getByRole('option', { name: '名称 A-Z' }).click()
    assert.deepEqual(await library.locator('.word-table tbody .collection-term strong').allTextContents(), [
        'alpha',
        'register',
        'zebra',
    ])
    await library.getByRole('combobox', { name: '排序方式' }).click()
    await library.getByRole('option', { name: '名称 Z-A' }).click()
    assert.deepEqual(await library.locator('.word-table tbody .collection-term strong').allTextContents(), [
        'zebra',
        'register',
        'alpha',
    ])
    assert.ok(
        await library.locator('.word-table thead tr').evaluate((row) => {
            const cells = [...row.children]
            return cells.at(-1)?.classList.contains('checkbox-col') === true
        }),
        'Word table checkboxes must be placed in the right-most column',
    )
    await library.getByLabel('选择 alpha').check()
    await library.getByLabel('选择 zebra').check()
    await library.getByText('已选 2 个词条', { exact: true }).waitFor()
    await library.getByRole('button', { name: '批量删除' }).click()
    await library.locator('.modal').getByRole('button', { name: '确认删除' }).click()
    await library.getByText('已删除 2 个词条', { exact: true }).waitFor()
    assert.deepEqual(await library.locator('.word-table tbody .collection-term strong').allTextContents(), [
        'register',
    ])
    await library
        .locator('.collection-meaning')
        .filter({ hasText: /^\s*登记\s*$/ })
        .waitFor()
    await library.getByRole('button', { name: '学习 3 级 (熟悉) - register', exact: true }).click()
    await library.locator('button[aria-pressed="true"][aria-label="学习 3 级 (熟悉) - register"]').waitFor()
    await library.getByRole('button', { name: '编辑 register', exact: true }).click()
    await library.getByLabel('对应翻译').fill('寄存器 / 登记')
    await library.getByRole('button', { name: '保存修改' }).click()
    await library
        .locator('.collection-meaning')
        .filter({ hasText: /^\s*寄存器 \/ 登记\s*$/ })
        .waitFor()
    await library.getByRole('button', { name: 'register', exact: true }).click()
    await library.getByRole('heading', { name: '遇词记录' }).waitFor()
    await library.locator('.encounter-list').getByText('登记', { exact: true }).waitFor()
    await library.getByRole('button', { name: '关闭词卡' }).click()
    await library.reload()
    await library.locator('button[aria-pressed="true"][aria-label="学习 3 级 (熟悉) - register"]').waitFor()
    await library
        .locator('.collection-meaning')
        .filter({ hasText: /^\s*寄存器 \/ 登记\s*$/ })
        .waitFor()
    await library.screenshot({ path: resolve(directory, 'library.png'), fullPage: true })
    await library.getByRole('link', { name: '返回词库' }).click()
    await library.getByRole('button', { name: '打开词库 - 阅读收藏' }).waitFor()
    await library.getByRole('button', { name: '添加词库' }).click()
    await library.getByRole('button', { name: '德语' }).click()
    await library.getByLabel('词库名称').fill('临时德语词库')
    await library.getByRole('button', { name: '保存词库' }).click()
    const tempDeCard = library.locator('.collection-card').filter({ hasText: '临时德语词库' })
    await tempDeCard.getByRole('button', { name: '编辑词库' }).click()
    await library.getByRole('button', { name: '删除词库' }).click()
    await library.locator('.modal').getByRole('button', { name: '确认删除' }).click()
    await tempDeCard.waitFor({ state: 'detached' })
    await library.screenshot({ path: resolve(directory, 'library-collections.png'), fullPage: true })
    const settingsNavFinal = options.getByRole('navigation', { name: '设置分类导航' })
    await settingsNavFinal.getByRole('button', { name: /外部生词本/ }).click()
    await options.getByRole('heading', { name: '外部生词本账号' }).waitFor()
    await settingsNavFinal.getByRole('button', { name: /Google Drive 云同步/ }).click()
    await options.getByRole('heading', { name: 'Google Drive 云同步' }).waitFor()
    await options.getByLabel('Google OAuth Client ID').fill('test-client.apps.googleusercontent.com')
    await options.getByRole('button', { name: '保存 Client ID' }).click()
    await options.getByText('Google OAuth Client ID 已保存', { exact: true }).waitFor()
    await settingsNavFinal.getByRole('button', { name: /翻译来源/ }).click()
    await options.setViewportSize({ width: 2560, height: 1440 })
    const aligned4k = await options.evaluate(() => {
        const headerTitle = document.querySelector('.page-header-inner h1')?.getBoundingClientRect()
        const subnav = document.querySelector('.settings-subnav')?.getBoundingClientRect()
        return headerTitle && subnav ? Math.abs(headerTitle.left - subnav.left) < 2 : false
    })
    assert.ok(aligned4k, 'Header title and Settings content must align vertically on 4K viewports')
    await options.screenshot({ path: resolve(directory, 'settings-4k.png'), fullPage: true })
    await options.setViewportSize({ width: 1440, height: 1000 })
    await options.screenshot({ path: resolve(directory, 'settings.png'), fullPage: true })
    const librarySecretCheck = await library.evaluate(async () => {
        const secrets = await chrome.runtime.sendMessage({
            channel: 'xgloss',
            operation: 'wordbookProfiles',
            requestId: crypto.randomUUID(),
        })
        const summaries = await chrome.runtime.sendMessage({
            channel: 'xgloss',
            operation: 'wordbookProfileSummaries',
            requestId: crypto.randomUUID(),
        })
        return { secrets: secrets.ok, summaries: summaries.ok }
    })
    assert.deepEqual(librarySecretCheck, { secrets: false, summaries: true })
    await library.getByRole('link', { name: '复习训练', exact: true }).click()
    await library.getByRole('heading', { name: '复习训练', exact: true }).waitFor()
    const libFilterBox = await library.getByRole('combobox', { name: '词库' }).boundingBox()
    const sizeFilterBox = await library.getByRole('combobox', { name: '每次词数' }).boundingBox()
    assert.ok(
        libFilterBox &&
            sizeFilterBox &&
            Math.abs(libFilterBox.y - sizeFilterBox.y) < 1 &&
            Math.abs(libFilterBox.height - sizeFilterBox.height) < 1,
        'Review filter dropdowns must align horizontally and have matching heights',
    )
    await library.screenshot({ path: resolve(directory, 'review.png'), fullPage: true })
    await library.locator('.review-mode').first().getByRole('button', { name: '开始', exact: true }).click()
    await library.getByRole('button', { name: '查看释义', exact: true }).click()
    await library.locator('.review-definition').waitFor()
    await library.getByRole('button', { name: '继续学习', exact: true }).click()
    await library.getByRole('heading', { name: '本轮复习完成', exact: true }).waitFor()
    await library.getByRole('button', { name: '返回复习列表', exact: true }).click()
    await library
        .locator('.review-mode')
        .filter({ has: library.getByRole('heading', { name: '拼写练习', exact: true }) })
        .getByRole('button', { name: '开始', exact: true })
        .click()
    await library.getByPlaceholder('输入英文单词').fill('register')
    await library.getByRole('button', { name: '检查', exact: true }).click()
    await library.getByText('拼写正确', { exact: true }).waitFor()
    await library.getByRole('button', { name: '继续学习', exact: true }).click()
    await library.getByRole('heading', { name: '本轮复习完成', exact: true }).waitFor()
    await library.getByRole('button', { name: '返回复习列表', exact: true }).click()
    await library
        .locator('.review-mode')
        .filter({ has: library.getByRole('heading', { name: '词义 -> 单词', exact: true }) })
        .getByRole('button', { name: '开始', exact: true })
        .click()
    await library.getByPlaceholder('输入英文单词').fill('register')
    await library.getByRole('button', { name: '检查', exact: true }).click()
    await library.getByText('拼写正确', { exact: true }).waitFor()
    await library.getByRole('button', { name: '继续学习', exact: true }).click()
    await library.getByRole('heading', { name: '本轮复习完成', exact: true }).waitFor()
    await library.getByRole('link', { name: '学习统计', exact: true }).click()
    await library.getByRole('heading', { name: '学习活动日历', exact: true }).waitFor()
    await library.getByText('调整等级 - 学习 3 级 (熟悉)', { exact: true }).waitFor()
    await library.getByText('完成复习 - 学习 3 级 (熟悉)', { exact: true }).first().waitFor()
    assert.equal(
        await library.locator('.heatmap-cell[aria-pressed="true"]').getAttribute('data-intensity'),
        '1',
    )
    await library.locator('.heatmap-cell[aria-pressed="true"]').press('ArrowUp')
    await library.getByText('当天没有学习记录.', { exact: true }).waitFor()
    await library.screenshot({ path: resolve(directory, 'statistics.png'), fullPage: true })
    await library.setViewportSize({ width: 390, height: 844 })
    await library.waitForFunction(() => {
        const active = document.querySelector('.heatmap-cell[aria-pressed="true"]')?.getBoundingClientRect()
        const viewport = document.querySelector('.heatmap-scroll')?.getBoundingClientRect()
        return active && viewport && active.left >= viewport.left && active.right <= viewport.right + 1
    })
    assert.ok(
        await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Narrow layouts must not overflow horizontally',
    )
    await library.screenshot({ path: resolve(directory, 'statistics-mobile.png'), fullPage: true })

    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${id}/popup.html`)
    await popup.getByRole('radio', { name: '自动', checked: true }).waitFor()
    await popup
        .getByRole('combobox', { name: '当前词库', disabled: false })
        .filter({ hasText: /N1 核心词库/ })
        .waitFor()
    await popup.locator('.popup').screenshot({ path: resolve(directory, 'popup.png') })
    await popup.getByRole('combobox', { name: '当前词库' }).click()
    await popup.getByRole('option', { name: /阅读收藏/ }).click()
    await popup
        .getByRole('combobox', { name: '原语言', disabled: false })
        .filter({ hasText: '英语' })
        .waitFor()
    await popup.getByRole('combobox', { name: '当前词库' }).click()
    await popup.getByRole('option', { name: /N1 核心词库/ }).click()
    await popup
        .getByRole('combobox', { name: '原语言', disabled: false })
        .filter({ hasText: '日语' })
        .waitFor()
    await popup.getByRole('combobox', { name: '原语言' }).click()
    await popup.getByRole('option', { name: '英语' }).click()
    await popup
        .getByRole('combobox', { name: '原语言', disabled: false })
        .filter({ hasText: '英语' })
        .waitFor()
    assert.match(await popup.getByRole('combobox', { name: '当前词库' }).textContent(), /N1 核心词库/)
    await popup.getByRole('combobox', { name: '当前词库' }).click()
    await popup.getByRole('option', { name: /阅读收藏/ }).click()
    await popup
        .getByRole('combobox', { name: '当前词库', disabled: false })
        .filter({ hasText: /阅读收藏/ })
        .waitFor()
    await popup.getByRole('combobox', { name: '原语言' }).click()
    await popup.getByRole('option', { name: '自动检测' }).click()
    await popup
        .getByRole('combobox', { name: '原语言', disabled: false })
        .filter({ hasText: '自动检测' })
        .waitFor()

    await popup.getByRole('radio', { name: '图标' }).click()
    await popup.getByRole('radio', { name: '图标', checked: true, disabled: false }).waitFor()
    await article.bringToFront()
    await article.evaluate(() => window.scrollTo(0, 0))
    if (await readingPanel.isVisible()) await readingPanel.getByRole('button', { name: '收起面板' }).click()
    await article.waitForTimeout(80)
    const selectInlineWord = () =>
        article.locator('#inline-register').evaluate((element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const selection = window.getSelection()
            selection.removeAllRanges()
            selection.addRange(range)
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }))
        })
    await selectInlineWord()
    const triggerIcon = article.getByRole('button', { name: '用 XGloss 翻译选中内容' })
    await triggerIcon.waitFor()
    assert.equal(await article.locator('.word-card').count(), 0)
    await triggerIcon.click()
    await card.locator('.meaning-option').first().waitFor()
    await article.keyboard.press('Escape')
    await card.waitFor({ state: 'detached' })

    await popup.bringToFront()
    await popup.getByRole('radio', { name: '关闭' }).click()
    await popup.getByRole('radio', { name: '关闭', checked: true, disabled: false }).waitFor()
    await article.bringToFront()
    await article.waitForTimeout(80)
    await selectInlineWord()
    await article.waitForTimeout(80)
    assert.equal(await triggerIcon.count(), 0)
    assert.equal(await article.locator('.word-card').count(), 0)
    await badge.click()
    await readingPanel.getByRole('button', { name: /^hardware ×/ }).click()
    await card.locator('.meaning-option').first().waitFor()
    await article.keyboard.press('Escape')

    await popup.bringToFront()
    await popup.getByRole('radio', { name: '自动' }).click()
    await popup.getByRole('radio', { name: '自动', checked: true, disabled: false }).waitFor()
    await popup.close()

    const reader = await context.newPage()
    await reader.goto(`chrome-extension://${id}/reader.html`)
    await reader
        .locator('input[type=file]')
        .setInputFiles({ name: 'technical-handbook.pdf', mimeType: 'application/pdf', buffer: pdf })
    await reader.locator('.textLayer span').first().waitFor()
    await reader.getByRole('button', { name: '词汇面板', exact: true }).click()
    await reader.locator('.pdf-scroll').hover({ position: { x: 30, y: 100 } })
    await reader.mouse.wheel(0, 1100)
    await reader.waitForFunction(() => Number(document.querySelector('input[aria-label="页码"]')?.value) > 1)
    await reader.getByLabel('页面布局', { exact: true }).selectOption('true')
    await reader.getByLabel('滚动方式', { exact: true }).selectOption('false')
    await reader.getByLabel('页码', { exact: true }).fill('1')
    await reader.getByLabel('页码', { exact: true }).press('Tab')
    const rightText = reader.locator('[data-page-number="2"] .textLayer span').first()
    await rightText.waitFor()
    await rightText.evaluate((span) => {
        const text = span.firstChild
        const start = text.textContent.indexOf('register')
        const range = document.createRange()
        range.setStart(text, start)
        range.setEnd(text, start + 'register'.length)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await reader.waitForFunction(() => {
        const popup = document.querySelector('.floating-card')?.getBoundingClientRect()
        const selection = window.getSelection()
        if (!popup || !selection?.rangeCount) return false
        const chosen = selection.getRangeAt(0).getBoundingClientRect()
        return popup.left >= chosen.left - 12 && popup.top >= chosen.bottom && popup.right < innerWidth
    })
    const pdfSpotlight = reader.locator('.word-card').getByRole('button', { name: 'Spotlight 正文高亮' })
    await reader.waitForFunction(() => CSS.highlights.size === 0)
    await reader
        .locator('.word-card')
        .getByRole('button', { name: 'Spotlight 正文高亮', pressed: false })
        .waitFor()
    await pdfSpotlight.click()
    await reader.waitForFunction(() => (CSS.highlights.get('xgloss-unknown')?.size ?? 0) > 0)
    await readingPanel.getByRole('button', { name: 'Spotlight 正文高亮', pressed: true }).waitFor()
    await otherSite.getByRole('button', { name: 'Spotlight 正文高亮', pressed: true }).waitFor()
    await otherSite.close()
    await reader.locator('.word-card').getByRole('button', { name: '学习 4 级 (已学) - register' }).click()
    await reader.getByText('已保存 - 学习 4 级 (已学)', { exact: true }).waitFor()
    assert.ok(
        await reader.evaluate(async () => {
            const result = await chrome.runtime.sendMessage({
                channel: 'xgloss',
                operation: 'encounters',
                input: 'register',
                requestId: crypto.randomUUID(),
            })
            return result.value.some((item) => item.page === 2 && item.context.includes('page 2'))
        }),
        'Selecting a word in the right page must save page 2 and its context',
    )
    await reader.getByRole('button', { name: '关闭词卡' }).click()
    await rightText.evaluate((span) => {
        const range = document.createRange()
        range.selectNodeContents(span)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await reader.locator('.word-card').getByText('这是完整的选区译文.', { exact: true }).waitFor()
    assert.equal(await reader.locator('.word-card .word-rating-controls').count(), 0)
    assert.ok(
        translationInputs.some(({ selectedText }) => /^Hardware register .* page 2$/.test(selectedText)),
    )
    await reader.getByRole('button', { name: '关闭词卡' }).click()
    await reader.locator('.pdf-scroll').evaluate((scroll) => {
        scroll.scrollTop = scroll.scrollHeight
    })
    await reader.locator('.pdf-scroll').hover({ position: { x: 30, y: 100 } })
    await reader.mouse.wheel(0, 1300)
    await reader.waitForFunction(() => Number(document.querySelector('input[aria-label="页码"]')?.value) >= 3)
    await reader.getByRole('button', { name: '目录', exact: true }).click()
    await reader.getByRole('button', { name: 'DMA reference', exact: true }).click()
    await reader.waitForFunction(() => document.querySelector('input[aria-label="页码"]')?.value === '3')
    await reader.getByRole('button', { name: '添加本页书签' }).click()
    await reader.getByRole('button', { name: '移除本页书签' }).waitFor()
    await reader.getByRole('button', { name: '书签', exact: true }).click()
    await reader.getByRole('button', { name: '第 3 页', exact: true }).waitFor()
    await reader.getByRole('button', { name: '书签', exact: true }).click()
    await reader.getByLabel('页面布局', { exact: true }).selectOption('false')
    await reader.getByLabel('页码', { exact: true }).fill('300')
    await reader.getByLabel('页码', { exact: true }).press('Tab')
    await reader.getByLabel('缩放', { exact: true }).selectOption('1.5')
    await reader.getByRole('button', { name: '旋转', exact: true }).click()
    await reader.waitForFunction(() =>
        document.querySelector('[data-page-number="300"] .textLayer')?.textContent?.includes('page 300'),
    )
    assert.ok((await reader.locator('.pdfViewer .page canvas').count()) <= 2)
    const geometry = await reader.evaluate(() => {
        const canvas = document.querySelector('[data-page-number="300"] canvas').getBoundingClientRect()
        const text = document
            .querySelector('[data-page-number="300"] .textLayer span')
            .getBoundingClientRect()
        return {
            inside:
                text.left >= canvas.left - 2 &&
                text.right <= canvas.right + 2 &&
                text.top >= canvas.top - 2 &&
                text.bottom <= canvas.bottom + 2,
            rotatedAlignment: text.left - canvas.left > canvas.width * 0.8,
        }
    })
    assert.ok(geometry.inside, 'PDF text layer must align with the rendered page')
    assert.ok(geometry.rotatedAlignment, 'The rotated text layer must align with the original baseline')
    await reader.screenshot({ path: resolve(directory, 'pdf.png') })
    await reader.reload()
    await reader
        .locator('input[type=file]')
        .setInputFiles({ name: 'technical-handbook.pdf', mimeType: 'application/pdf', buffer: pdf })
    await reader.waitForFunction(() => document.querySelector('input[aria-label="页码"]')?.value === '300')
    await reader.getByRole('button', { name: /^展开阅读面板/ }).click()
    await reader.locator('.statistics').getByText('1,500', { exact: true }).waitFor({ timeout: 30_000 })
    await reader.getByRole('button', { name: '收起面板' }).click()
    await reader.getByRole('button', { name: '书签', exact: true }).click()
    await reader.getByRole('button', { name: '第 3 页', exact: true }).click()
    await reader.waitForFunction(() => document.querySelector('input[aria-label="页码"]')?.value === '3')
    await reader.getByRole('button', { name: '移除本页书签' }).click()
    await reader.getByText('使用工具栏为当前页添加书签.', { exact: true }).waitFor()
    await reader.getByPlaceholder('在线 PDF 链接').fill(origin + '/sample.pdf')
    await reader.getByRole('button', { name: '打开链接', exact: true }).click()
    await reader.waitForFunction(
        () => document.querySelector('.document-title')?.textContent === 'sample.pdf',
    )
    await reader.locator('.textLayer span').first().waitFor()
    assert.deepEqual(errors, [])
    console.log(
        JSON.stringify(
            {
                success: true,
                pages: 300,
                paragraphs: 2000,
                observedWebRanges: ranges,
                translationRequests,
                screenshots: directory,
            },
            null,
            2,
        ),
    )
} catch (error) {
    for (const page of context.pages())
        console.error(page.url(), await page.locator('.error').allTextContents())
    throw error
} finally {
    await context.close()
    await new Promise((resolve) => server.close(resolve))
}
