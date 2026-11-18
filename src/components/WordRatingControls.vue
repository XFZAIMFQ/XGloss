<script setup lang="ts">
import { learningLevels, type WordRating } from '../domain/models'

defineProps<{ word: string; rating?: WordRating; busy?: boolean }>()
const emit = defineEmits<{ rate: [rating: WordRating] }>()
</script>

<template>
    <div class="word-rating-controls" role="group" :aria-label="word + ' 的掌握等级'">
        <button
            v-for="level in learningLevels"
            :key="level"
            type="button"
            :class="{ primary: rating?.state === 'learning' && (rating.level ?? 1) === level }"
            :aria-label="`学习 ${level} 级 · ${word}`"
            :aria-pressed="rating?.state === 'learning' && (rating.level ?? 1) === level"
            :disabled="busy"
            @click="emit('rate', { state: 'learning', level })"
        >
            {{ level }}
        </button>
        <button
            type="button"
            :aria-label="'已掌握 · ' + word"
            :aria-pressed="rating?.state === 'known'"
            :class="{ primary: rating?.state === 'known' }"
            :disabled="busy"
            @click="emit('rate', { state: 'known' })"
        >
            掌握
        </button>
        <button
            type="button"
            :aria-label="'忽略 · ' + word"
            :aria-pressed="rating?.state === 'ignored'"
            :class="{ primary: rating?.state === 'ignored' }"
            :disabled="busy"
            @click="emit('rate', { state: 'ignored' })"
        >
            忽略
        </button>
    </div>
</template>
