<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { FlagCode } from '../domain/collections'
import LanguageFlag from './LanguageFlag.vue'

export interface SelectOption {
    value: string
    label: string
    flag?: FlagCode | null
    muted?: string
}

const props = withDefaults(
    defineProps<{
        modelValue: string
        options: readonly SelectOption[]
        size?: 'sm' | 'md'
        align?: 'left' | 'right'
        placement?: 'auto' | 'bottom' | 'top'
        disabled?: boolean
        ariaLabel?: string
        placeholder?: string
        minMenuWidth?: number
    }>(),
    {
        size: 'md',
        align: 'left',
        placement: 'auto',
        disabled: false,
        ariaLabel: undefined,
        placeholder: '',
        minMenuWidth: undefined,
    },
)

const emit = defineEmits<{
    'update:modelValue': [value: string]
    change: [value: string]
}>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const activeIndex = ref(-1)
const resolvedPlacement = ref<'bottom' | 'top'>('bottom')
const menuMaxHeight = ref(230)

const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
const displayLabel = computed(() => selected.value?.label || props.placeholder || props.modelValue)
const menuStyle = computed(() => ({
    ...(props.minMenuWidth ? { minWidth: `${props.minMenuWidth}px` } : {}),
    maxHeight: `${menuMaxHeight.value}px`,
}))

function toggle() {
    if (props.disabled) return
    if (open.value) {
        close()
    } else {
        openMenu()
    }
}

function openMenu() {
    if (props.disabled) return
    const rect = trigger.value?.getBoundingClientRect()
    const spaceBelow = rect ? window.innerHeight - rect.bottom : 230
    const spaceAbove = rect ? rect.top : 0
    if (props.placement === 'auto') {
        resolvedPlacement.value = spaceBelow < 220 && spaceAbove > spaceBelow ? 'top' : 'bottom'
    } else {
        resolvedPlacement.value = props.placement
    }
    const available = resolvedPlacement.value === 'top' ? spaceAbove : spaceBelow
    menuMaxHeight.value = Math.max(96, Math.min(230, Math.floor(available - 12)))
    open.value = true
    const index = props.options.findIndex((option) => option.value === props.modelValue)
    activeIndex.value = index >= 0 ? index : 0
}

function close(restoreFocus = false) {
    open.value = false
    activeIndex.value = -1
    if (restoreFocus) trigger.value?.focus()
}

function choose(value: string) {
    close(true)
    if (value !== props.modelValue) {
        emit('update:modelValue', value)
        emit('change', value)
    }
}

function moveActive(delta: number) {
    if (!props.options.length) return
    const next = (activeIndex.value + delta + props.options.length) % props.options.length
    activeIndex.value = next
}

function onKeydown(event: KeyboardEvent) {
    if (props.disabled) return
    if (!open.value) {
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault()
            openMenu()
        }
        return
    }
    if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveActive(1)
        return
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveActive(-1)
        return
    }
    if (event.key === 'Home') {
        event.preventDefault()
        activeIndex.value = 0
        return
    }
    if (event.key === 'End') {
        event.preventDefault()
        activeIndex.value = Math.max(0, props.options.length - 1)
        return
    }
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const option = props.options[activeIndex.value]
        if (option) choose(option.value)
    }
}

function onOutsidePointerDown(event: PointerEvent) {
    if (!open.value || !root.value) return
    if (!event.composedPath().includes(root.value)) close(false)
}

onMounted(() => {
    document.addEventListener('pointerdown', onOutsidePointerDown, { capture: true })
})

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onOutsidePointerDown, { capture: true })
})
</script>

<template>
    <div ref="root" class="shadcn-select" :class="[`size-${size}`, { 'is-open': open }]">
        <button
            ref="trigger"
            type="button"
            role="combobox"
            class="shadcn-select-trigger"
            :aria-expanded="open"
            :aria-label="ariaLabel"
            aria-haspopup="listbox"
            :disabled="disabled"
            @click="toggle"
            @keydown="onKeydown"
        >
            <span class="shadcn-select-value">
                <LanguageFlag
                    v-if="selected?.flag"
                    :language="selected.flag"
                    :size="size === 'sm' ? 14 : 15"
                />
                <span class="shadcn-select-label">{{ displayLabel }}</span>
            </span>
            <ChevronDown :size="size === 'sm' ? 13 : 14" class="shadcn-select-chevron" />
        </button>

        <div
            v-if="open"
            role="listbox"
            :aria-label="ariaLabel"
            class="shadcn-select-menu"
            :class="[`align-${align}`, `place-${resolvedPlacement}`]"
            :style="menuStyle"
            @keydown="onKeydown"
        >
            <button
                v-for="(option, index) in options"
                :key="option.value"
                type="button"
                role="option"
                class="shadcn-select-option"
                :class="{
                    'is-selected': option.value === modelValue,
                    'is-active': index === activeIndex,
                }"
                :aria-selected="option.value === modelValue"
                @mouseenter="activeIndex = index"
                @click.stop="choose(option.value)"
            >
                <LanguageFlag v-if="option.flag" :language="option.flag" :size="14" />
                <span class="shadcn-select-option-label">{{ option.label }}</span>
                <span v-if="option.muted" class="shadcn-select-option-muted">{{ option.muted }}</span>
                <Check
                    v-if="option.value === modelValue"
                    :size="13"
                    :stroke-width="2.2"
                    class="shadcn-select-check"
                />
            </button>
        </div>
    </div>
</template>
