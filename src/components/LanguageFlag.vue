<script setup lang="ts">
import { computed } from 'vue'
import type { CollectionLanguage } from '../domain/models'

const props = withDefaults(
    defineProps<{
        language: CollectionLanguage
        size?: number
    }>(),
    { size: 18 },
)

const height = computed(() => Math.round(props.size * 0.72))
</script>

<template>
    <svg class="language-flag" :width="size" :height="height" viewBox="0 0 60 40" aria-hidden="true">
        <template v-if="language === 'en'">
            <rect width="60" height="40" fill="#ffffff" />
            <g fill="#b22234">
                <rect width="60" height="3.2" y="0" />
                <rect width="60" height="3.2" y="6.1" />
                <rect width="60" height="3.2" y="12.3" />
                <rect width="60" height="3.2" y="18.4" />
                <rect width="60" height="3.2" y="24.6" />
                <rect width="60" height="3.2" y="30.7" />
                <rect width="60" height="3.2" y="36.8" />
            </g>
            <rect width="24" height="21.6" fill="#3c3b6e" />
            <g fill="#ffffff">
                <circle cx="5" cy="5" r="1.2" />
                <circle cx="12" cy="5" r="1.2" />
                <circle cx="19" cy="5" r="1.2" />
                <circle cx="8.5" cy="10.8" r="1.2" />
                <circle cx="15.5" cy="10.8" r="1.2" />
                <circle cx="5" cy="16.5" r="1.2" />
                <circle cx="12" cy="16.5" r="1.2" />
                <circle cx="19" cy="16.5" r="1.2" />
            </g>
        </template>
        <template v-else-if="language === 'ja'">
            <rect width="60" height="40" fill="#ffffff" />
            <circle cx="30" cy="20" r="11" fill="#bc002d" />
        </template>
        <template v-else-if="language === 'ko'">
            <rect width="60" height="40" fill="#ffffff" />
            <circle cx="30" cy="20" r="10" fill="#cd2e3a" />
            <path d="M20,20 a10,10 0 0,0 20,0 a5,5 0 0,1 -10,0 a5,5 0 0,0 -10,0" fill="#0047a0" />
            <g stroke="#09090b" stroke-width="2">
                <line x1="10" y1="8" x2="16" y2="14" />
                <line x1="44" y1="14" x2="50" y2="8" />
                <line x1="10" y1="32" x2="16" y2="26" />
                <line x1="44" y1="26" x2="50" y2="32" />
            </g>
        </template>
        <template v-else-if="language === 'de'">
            <rect width="60" height="13.4" y="0" fill="#18181b" />
            <rect width="60" height="13.4" y="13.3" fill="#dd0000" />
            <rect width="60" height="13.4" y="26.6" fill="#ffce00" />
        </template>
        <template v-else-if="language === 'fr'">
            <rect width="20" height="40" x="0" fill="#002395" />
            <rect width="20" height="40" x="20" fill="#ffffff" />
            <rect width="20" height="40" x="40" fill="#ed2939" />
        </template>
        <template v-else-if="language === 'es'">
            <rect width="60" height="10" y="0" fill="#aa151b" />
            <rect width="60" height="20" y="10" fill="#f1bf00" />
            <rect width="60" height="10" y="30" fill="#aa151b" />
        </template>
        <template v-else-if="language === 'ru'">
            <rect width="60" height="13.4" y="0" fill="#ffffff" />
            <rect width="60" height="13.4" y="13.3" fill="#0039a6" />
            <rect width="60" height="13.4" y="26.6" fill="#d52b1e" />
        </template>
        <template v-else>
            <rect width="20" height="40" x="0" fill="#009246" />
            <rect width="20" height="40" x="20" fill="#ffffff" />
            <rect width="20" height="40" x="40" fill="#ce2b37" />
        </template>
    </svg>
</template>

<style scoped>
.language-flag {
    display: block;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
    flex-shrink: 0;
}
</style>
