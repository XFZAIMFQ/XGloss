<script setup lang="ts">
import { ref } from 'vue'
import { Highlighter } from '@lucide/vue'
import { errorMessage } from '../domain/models'

const props = defineProps<{ enabled: boolean; setEnabled: (enabled: boolean) => void | Promise<void> }>()
const busy = ref(false)
const error = ref('')
async function toggle() {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
        await props.setEnabled(!props.enabled)
    } catch (reason) {
        error.value = errorMessage(reason)
    } finally {
        busy.value = false
    }
}
</script>

<template>
    <span class="spotlight-control">
        <button
            type="button"
            class="icon-button spotlight-button"
            aria-label="Spotlight 正文高亮"
            title="Spotlight · 对所有网页和 PDF 生效"
            :aria-pressed="enabled"
            :disabled="busy"
            @click="toggle"
        >
            <Highlighter :size="16" />
        </button>
        <span v-if="error" class="spotlight-error error small" role="alert">{{ error }}</span>
    </span>
</template>
