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
const server = createServer((request, response) => {
    if (request.url === '/v1/chat/completions') {
        translationRequests++
        let data = ''
        request.on('data', (chunk) => {
            data += chunk
        })
        request.on('end', () => {
            assert.equal(JSON.parse(data).model, 'smoke-model')
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ choices: [{ message: { content: '寄存器 · 测试语境释义' } }] }))
        })
    } else if (request.url === '/sample.pdf') {
        response.setHeader('Content-Type', 'application/pdf')
        response.end(pdf)
    } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(
            '<!doctype html><title>Long technical document</title><main>' +
                '<p>Hardware register learning vocabulary and embedded firmware documentation.</p>'.repeat(
                    2000,
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
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
})
const errors = []
context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)))
try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    const id = new URL(worker.url()).host
    const options = await context.newPage()
    await options.goto(`chrome-extension://${id}/options.html`)
    await options.getByPlaceholder('https://api.example.com/v1').fill(`${origin}/v1`)
    await options.getByPlaceholder('填写服务支持的模型 ID').fill('smoke-model')
    await options.getByRole('button', { name: '测试语境翻译' }).click()
    await options.getByText('寄存器 · 测试语境释义', { exact: true }).waitFor()
    assert.equal(translationRequests, 1)
    await options.getByRole('button', { name: '测试语境翻译' }).click()
    await options.getByText('寄存器 · 测试语境释义', { exact: true }).waitFor()
    assert.equal(translationRequests, 1, 'Identical translation should use the local cache')

    const article = await context.newPage()
    await article.goto(origin + '/article')
    const articleTab = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
        origin + '/article',
    )
    await worker.evaluate(
        (tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['web.js'] }),
        articleTab,
    )
    await article.getByText('已完成当前已加载内容的分析', { exact: true }).waitFor()
    assert.equal(await article.evaluate(() => document.querySelectorAll('p').length), 2000)
    await article.getByRole('button', { name: 'register ×2000' }).click()
    await article.waitForFunction(() =>
        /[\u4e00-\u9fff]/.test(
            document.querySelector('#xgloss-root')?.shadowRoot?.querySelector('.definition')?.textContent ??
                '',
        ),
    )
    await article.getByRole('button', { name: '加入生词', exact: true }).click()
    await article.getByText('已加入本地词库', { exact: true }).waitFor()
    await article.locator('.reading-panel').screenshot({ path: resolve(directory, 'reading-panel.png') })
    await article.locator('.word-card').screenshot({ path: resolve(directory, 'word-card.png') })
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
                    return settings.ok
                },
            }),
        articleTab,
    )
    assert.equal(accessChecks[0].result, false, 'Content scripts must not receive credentials')
    await article.evaluate(() => document.querySelector('main').firstElementChild.remove())
    await article.waitForFunction(
        () =>
            document.querySelector('#xgloss-root')?.shadowRoot?.querySelector('.statistics strong')
                ?.textContent === '15,992',
    )
    await article.getByRole('button', { name: '关闭 XGloss', exact: true }).click()
    assert.equal(await article.locator('#xgloss-root').count(), 0)
    assert.equal(await article.evaluate(() => CSS.highlights.size), 0)

    const library = await context.newPage()
    await library.goto(`chrome-extension://${id}/library.html`)
    await library.getByRole('button', { name: 'register 学习中' }).waitFor()
    await library.reload()
    await library.getByRole('button', { name: 'register 学习中' }).waitFor()
    await library.screenshot({ path: resolve(directory, 'library.png'), fullPage: true })
    await options.screenshot({ path: resolve(directory, 'settings.png'), fullPage: true })
    await library.getByRole('link', { name: '复习训练', exact: true }).click()
    await library.getByRole('heading', { name: '复习训练', exact: true }).waitFor()
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
        .filter({ has: library.getByRole('heading', { name: '词义 → 单词', exact: true }) })
        .getByRole('button', { name: '开始', exact: true })
        .click()
    await library.getByPlaceholder('输入英文单词').fill('register')
    await library.getByRole('button', { name: '检查', exact: true }).click()
    await library.getByText('拼写正确', { exact: true }).waitFor()
    await library.getByRole('button', { name: '继续学习', exact: true }).click()
    await library.getByRole('heading', { name: '本轮复习完成', exact: true }).waitFor()
    await library.getByRole('link', { name: '学习统计', exact: true }).click()
    await library.getByRole('heading', { name: '词汇更新日历', exact: true }).waitFor()
    await library.screenshot({ path: resolve(directory, 'statistics.png'), fullPage: true })
    await library.setViewportSize({ width: 390, height: 844 })
    assert.ok(
        await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Narrow layouts must not overflow horizontally',
    )
    await library.screenshot({ path: resolve(directory, 'statistics-mobile.png'), fullPage: true })

    const reader = await context.newPage()
    await reader.goto(`chrome-extension://${id}/reader.html`)
    await reader
        .locator('input[type=file]')
        .setInputFiles({ name: 'technical-handbook.pdf', mimeType: 'application/pdf', buffer: pdf })
    await reader.locator('.textLayer span').first().waitFor()
    await reader.getByRole('button', { name: '下一页', exact: true }).click()
    await reader.getByLabel('页码', { exact: true }).fill('300')
    await reader.getByLabel('页码', { exact: true }).press('Tab')
    await reader.getByLabel('缩放', { exact: true }).selectOption('1.5')
    await reader.getByRole('button', { name: '旋转', exact: true }).click()
    await reader.waitForFunction(() =>
        document.querySelector('.textLayer')?.textContent?.includes('page 300'),
    )
    assert.equal(await reader.locator('.pdf-page canvas').count(), 1)
    const geometry = await reader.evaluate(() => {
        const canvas = document.querySelector('.pdf-page canvas').getBoundingClientRect()
        const text = document.querySelector('.textLayer span').getBoundingClientRect()
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
    await reader.getByText('已分析 300 / 300 页', { exact: true }).waitFor({ timeout: 30_000 })
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
                rangeCap: ranges,
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
