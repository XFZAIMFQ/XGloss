<script setup lang="ts">
import { t } from '../i18n'
import { learningLevels, type WordRating } from '../domain/models'
import { learningLevelLabel, learningLevelName } from '../domain/vocabulary'

defineProps<{ word: string; rating?: WordRating; busy?: boolean }>()
const emit = defineEmits<{ rate: [rating: WordRating] }>()
</script>

<template>
    <div class="word-rating-controls" role="group" :aria-label="t('rating.wordLabel', { word })">
        <button
            v-for="level in learningLevels"
            :key="level"
            type="button"
            :class="{ primary: rating?.state === 'learning' && (rating.level ?? 1) === level }"
            :title="learningLevelLabel(level)"
            :aria-label="t('rating.learningWord', { level, name: learningLevelName(level), word })"
            :aria-pressed="rating?.state === 'learning' && (rating.level ?? 1) === level"
            :disabled="busy"
            @click="emit('rate', { state: 'learning', level })"
        >
            {{ level }}
        </button>
        <button
            type="button"
            :aria-label="t('rating.knownWord', { word })"
            :aria-pressed="rating?.state === 'known'"
            :class="{ primary: rating?.state === 'known' }"
            :disabled="busy"
            @click="emit('rate', { state: 'known' })"
        >
            {{ t('rating.markKnown') }}
        </button>
        <button
            type="button"
            :aria-label="t('rating.ignoredWord', { word })"
            :aria-pressed="rating?.state === 'ignored'"
            :class="{ primary: rating?.state === 'ignored' }"
            :disabled="busy"
            @click="emit('rate', { state: 'ignored' })"
        >
            {{ t('rating.ignore') }}
        </button>
    </div>
</template>
