import { onBeforeUnmount, onMounted, readonly, ref } from 'vue'
import { onReadingChanged, request } from '../../platform/messages'

export function useSpotlight(apply: (enabled: boolean) => void) {
    const enabled = ref(false)
    let generation = 0
    let unsubscribe: (() => void) | undefined

    async function reload() {
        const current = ++generation
        const value = await request('spotlight')
        if (current !== generation) return
        enabled.value = value
        apply(value)
    }

    async function setSpotlight(value: boolean) {
        await request('setSpotlight', value)
        if (unsubscribe) await reload()
    }

    onMounted(() => {
        const refresh = () => {
            void reload().catch(() => undefined)
        }
        unsubscribe = onReadingChanged((change) => {
            if (change === 'spotlight') refresh()
        })
        refresh()
    })
    onBeforeUnmount(() => {
        generation++
        unsubscribe?.()
        unsubscribe = undefined
    })
    return { highlighting: readonly(enabled), setSpotlight }
}
