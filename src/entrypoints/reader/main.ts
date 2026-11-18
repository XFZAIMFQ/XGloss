import { createApp } from 'vue'
import { locale, t } from '../../i18n'
import App from './App.vue'
import 'pdfjs-dist/web/pdf_viewer.css'
import '../../assets/ui.css'
import '../../assets/highlights.css'
import './reader.css'
document.documentElement.lang = locale
document.title = t('common.pageTitle', { title: t('common.pdf') })
createApp(App).mount('#app')
