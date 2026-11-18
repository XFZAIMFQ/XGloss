import { t } from './src/i18n'
import { defineConfig } from 'wxt'

export default defineConfig({
    srcDir: 'src',
    modules: ['@wxt-dev/module-vue'],
    manifest: {
        name: 'XGloss',
        description: t('extension.description'),
        permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
        optional_host_permissions: ['https://*/*', 'http://*/*'],
        action: { default_title: 'XGloss' },
        content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
        },
    },
})
