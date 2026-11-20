<script setup lang="ts">
import { t } from '../i18n'
import BrandLogo from './BrandLogo.vue'
import { BookOpen, GraduationCap, ChartNoAxesCombined, FileText, Settings2, HardDrive } from '@lucide/vue'

defineProps<{ active: string; known?: number }>()

const primaryLinks = [
    { id: 'library', href: 'library.html', label: t('common.library'), icon: BookOpen },
    { id: 'review', href: 'library.html#review', label: t('common.review'), icon: GraduationCap },
    {
        id: 'statistics',
        href: 'library.html#statistics',
        label: t('common.statistics'),
        icon: ChartNoAxesCombined,
    },
]

const secondaryLinks = [
    { id: 'pdf', href: 'reader.html', label: t('common.pdf'), icon: FileText },
    { id: 'settings', href: 'options.html', label: t('common.settings'), icon: Settings2 },
]
</script>

<template>
    <div class="app-layout">
        <aside class="app-sidebar">
            <a href="library.html" class="app-logo" :aria-label="t('shell.home')">
                <BrandLogo :size="28" />
                <span class="brand-meta">
                    <strong>XGloss</strong>
                    <small>Vocabulary</small>
                </span>
            </a>

            <div class="sidebar-group-label">{{ t('shell.learningSpace') }}</div>
            <nav class="app-nav" :aria-label="t('shell.navigation')">
                <a
                    v-for="link in primaryLinks"
                    :key="link.id"
                    :href="link.href"
                    :class="{ active: active === link.id }"
                    :aria-current="active === link.id ? 'page' : undefined"
                >
                    <component :is="link.icon" :size="16" :stroke-width="2" />
                    <span>{{ link.label }}</span>
                </a>
            </nav>

            <div class="sidebar-group-label sidebar-group-secondary">{{ t('shell.toolsAndConfig') }}</div>
            <nav class="app-nav" :aria-label="t('shell.toolsAndConfig')">
                <a
                    v-for="link in secondaryLinks"
                    :key="link.id"
                    :href="link.href"
                    :class="{ active: active === link.id }"
                    :aria-current="active === link.id ? 'page' : undefined"
                >
                    <component :is="link.icon" :size="16" :stroke-width="2" />
                    <span>{{ link.label }}</span>
                </a>
            </nav>

            <div class="sidebar-local">
                <span class="sidebar-local-icon">
                    <HardDrive :size="15" />
                </span>
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
            <header v-if="$slots.header" class="page-header-bar">
                <div class="page-header-inner">
                    <slot name="header" />
                </div>
            </header>
            <div class="page-content"><slot /></div>
        </main>
    </div>
</template>
