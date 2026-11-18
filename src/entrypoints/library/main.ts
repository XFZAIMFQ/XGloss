import { createApp } from 'vue'
import { locale, t } from '../../i18n'
import App from './App.vue'
import '../../assets/ui.css'
import '../../assets/learning.css'
import '../../assets/workspace.css'
document.documentElement.lang = locale
document.title = t('common.pageTitle', { title: t('common.localLibrary') })
createApp(App).mount('#app')
