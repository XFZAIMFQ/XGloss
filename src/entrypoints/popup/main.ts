import { createApp } from 'vue'
import { locale } from '../../i18n'
import App from './App.vue'
import '../../assets/ui.css'
document.documentElement.lang = locale
createApp(App).mount('#app')
