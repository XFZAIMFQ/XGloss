import { t } from './src/i18n'
import { defineConfig } from 'wxt'

export default defineConfig({
    srcDir: 'src',
    modules: ['@wxt-dev/module-vue'],
    manifest: {
        name: 'XGloss',
        description: t('extension.description'),
        icons: {
            16: 'icon/16.png',
            32: 'icon/32.png',
            48: 'icon/48.png',
            128: 'icon/128.png',
        },
        permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
        optional_host_permissions: ['https://*/*', 'http://*/*'],
        action: {
            default_title: 'XGloss',
            default_icon: {
                16: 'icon/16.png',
                32: 'icon/32.png',
                48: 'icon/48.png',
                128: 'icon/128.png',
            },
        },
        content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
        },
    },
})
