import { createApp } from 'vue'
import { locale, t } from '../../i18n'
import App from './App.vue'
import '../../assets/ui.css'
import '../../assets/workspace.css'
document.documentElement.lang = locale
document.title = t('common.pageTitle', { title: t('common.settings') })
createApp(App).mount('#app')
