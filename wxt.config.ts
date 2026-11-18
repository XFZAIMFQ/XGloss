import { defineConfig } from 'wxt'

export default defineConfig({
    srcDir: 'src',
    modules: ['@wxt-dev/module-vue'],
    manifest: {
        name: 'XGloss',
        description: '在网页和 PDF 中积累自己的词汇，支持可配置的兼容翻译接口。',
        permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
        optional_host_permissions: ['https://*/*', 'http://*/*'],
        action: { default_title: 'XGloss' },
        content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
        },
    },
})
