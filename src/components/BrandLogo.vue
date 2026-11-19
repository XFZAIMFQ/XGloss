<script setup lang="ts">
import { useId } from 'vue'

withDefaults(defineProps<{ size?: number }>(), { size: 28 })

const id = useId()
const bgId = `xgloss-bg-${id}`
const dotId = `xgloss-dot-${id}`
</script>

<template>
    <svg class="brand-logo" :width="size" :height="size" viewBox="0 0 128 128" fill="none" aria-hidden="true">
        <defs>
            <linearGradient :id="bgId" x1="64" y1="4" x2="64" y2="124" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#27272a" />
                <stop offset="100%" stop-color="#09090b" />
            </linearGradient>
            <linearGradient :id="dotId" x1="84" y1="84" x2="102" y2="102" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#fbbf24" />
                <stop offset="100%" stop-color="#f59e0b" />
            </linearGradient>
        </defs>
        <rect x="4" y="4" width="120" height="120" rx="28" :fill="`url(#${bgId})`" />
        <rect
            x="4.75"
            y="4.75"
            width="118.5"
            height="118.5"
            rx="27.25"
            stroke="#ffffff"
            stroke-opacity="0.12"
            stroke-width="1.5"
        />
        <path d="M35 93L51 77" stroke="#a1a1aa" stroke-width="15" stroke-linecap="round" />
        <path d="M77 51L93 35" stroke="#fafafa" stroke-width="15" stroke-linecap="round" />
        <path d="M35 35L72 72" stroke="#fafafa" stroke-width="15" stroke-linecap="round" />
        <circle cx="93" cy="93" r="9" :fill="`url(#${dotId})`" />
    </svg>
</template>

<style scoped>
.brand-logo {
    display: block;
    flex-shrink: 0;
}
</style>
