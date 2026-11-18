<script setup lang="ts">
import { t } from '../i18n'
import { BookOpen, GraduationCap, ChartNoAxesCombined, FileText, Settings2, HardDrive } from '@lucide/vue'
defineProps<{ active: string; known?: number }>()
const links = [
    { id: 'library', href: 'library.html', label: t('common.library'), icon: BookOpen },
    { id: 'review', href: 'library.html#review', label: t('common.review'), icon: GraduationCap },
    {
        id: 'statistics',
        href: 'library.html#statistics',
        label: t('common.statistics'),
        icon: ChartNoAxesCombined,
    },
    { id: 'pdf', href: 'reader.html', label: t('common.pdf'), icon: FileText },
    { id: 'settings', href: 'options.html', label: t('common.settings'), icon: Settings2 },
]
</script>

<template>
    <div class="app-layout">
        <aside class="app-sidebar">
            <a href="library.html" class="app-logo" :aria-label="t('shell.home')">
                <span>
                    X
                    <span class="logo-dot">.</span>
                </span>
                <strong>Gloss</strong>
            </a>
            <nav class="app-nav" :aria-label="t('shell.navigation')">
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
                    <strong>{{ t('shell.workspace') }}</strong>
                    <span>
                        {{
                            known === undefined
                                ? t('shell.localStorage')
                                : t('shell.knownCount', { count: known })
                        }}
                    </span>
                </div>
            </div>
        </aside>
        <main class="app-main">
            <div class="page-content"><slot /></div>
        </main>
    </div>
</template>
