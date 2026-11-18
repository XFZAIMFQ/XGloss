<script setup lang="ts">
import { BookOpen, GraduationCap, ChartNoAxesCombined, FileText, Settings2, HardDrive } from '@lucide/vue'
defineProps<{ active: string; known?: number }>()
const links = [
    { id: 'library', href: 'library.html', label: '我的词库', icon: BookOpen },
    { id: 'review', href: 'library.html#review', label: '复习训练', icon: GraduationCap },
    { id: 'statistics', href: 'library.html#statistics', label: '学习统计', icon: ChartNoAxesCombined },
    { id: 'pdf', href: 'reader.html', label: 'PDF 阅读器', icon: FileText },
    { id: 'settings', href: 'options.html', label: '翻译设置', icon: Settings2 },
]
</script>

<template>
    <div class="app-layout">
        <aside class="app-sidebar">
            <a href="library.html" class="app-logo" aria-label="XGloss 首页">
                <span>
                    X
                    <span class="logo-dot">.</span>
                </span>
                <strong>Gloss</strong>
            </a>
            <nav class="app-nav" aria-label="主导航">
                <a
                    v-for="link in links"
                    :key="link.id"
                    :href="link.href"
                    :class="{ active: active === link.id }"
                    :aria-current="active === link.id ? 'page' : undefined"
                >
                    <component :is="link.icon" :size="21" :stroke-width="2" />
                    <span>{{ link.label }}</span>
                </a>
            </nav>
            <div class="sidebar-local">
                <HardDrive :size="18" />
                <div>
                    <strong>本地学习空间</strong>
                    <span>{{ known === undefined ? '数据保存在这台电脑' : `${known} 个已掌握词汇` }}</span>
                </div>
            </div>
        </aside>
        <main class="app-main">
            <div class="page-content"><slot /></div>
        </main>
    </div>
</template>
