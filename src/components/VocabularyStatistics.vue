<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BookOpen, Check, Bookmark, EyeOff, CalendarDays } from '@lucide/vue'
import { errorMessage, type LearningActivity, type Word } from '../domain/models'
import { activityStreaks, localDay } from '../domain/activity'
import { ratingLabel } from '../domain/vocabulary'
import { onVocabularyChanged, request } from '../platform/messages'
const props = defineProps<{ words: Word[] }>()
const known = computed(() => props.words.filter((word) => word.state === 'known').length)
const learning = computed(() => props.words.filter((word) => word.state === 'learning').length)
const ignored = computed(() => props.words.filter((word) => word.state === 'ignored').length)
const progress = computed(() =>
    props.words.length ? Math.round((known.value / props.words.length) * 100) : 0,
)
const today = new Date()
today.setHours(0, 0, 0, 0)
function addDays(date: Date, days: number) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}
const first = addDays(today, -364)
const firstSunday = addDays(first, -first.getDay())
const calendar = Array.from({ length: 371 }, (_, index) => {
    const date = addDays(firstSunday, index)
    return {
        date,
        label: localDay(date),
        row: date.getDay() + 2,
        column: Math.floor(index / 7) + 2,
        available: date >= first && date <= today,
    }
})
const months = calendar.filter(({ date, available }) => available && date.getDate() === 1)
const visibleDays = calendar.filter(({ available }) => available)
const selected = ref(localDay(today))
const counts = ref<Record<string, number>>({})
const activity = ref<LearningActivity[]>([])
const loading = ref(true)
const loadingDay = ref(true)
const error = ref('')
const dayError = ref('')
const heatmapScroll = ref<HTMLElement>()
const streaks = computed(() => activityStreaks(counts.value, first, today))
const labels = { added: '新增词条', rated: '调整等级', reviewed: '完成复习' }
const wordsByKey = computed(() => new Map(props.words.map((word) => [word.key, word.text])))
let summaryGeneration = 0
let dayGeneration = 0
let unsubscribe: (() => void) | undefined
let resize: ResizeObserver | undefined

function intensity(count: number) {
    return count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 10 ? 3 : 4
}
async function refresh() {
    const generation = ++summaryGeneration
    try {
        const result = await request('activityCounts', {
            from: first.getTime(),
            to: addDays(today, 1).getTime(),
        })
        if (generation !== summaryGeneration) return
        counts.value = result
        error.value = ''
    } catch (reason) {
        if (generation === summaryGeneration) error.value = errorMessage(reason)
    } finally {
        if (generation === summaryGeneration) loading.value = false
    }
}
async function refreshDay() {
    const generation = ++dayGeneration
    loadingDay.value = true
    dayError.value = ''
    const date = visibleDays.find((day) => day.label === selected.value)!.date
    try {
        const rows = await request('activitiesForDay', {
            from: date.getTime(),
            to: addDays(date, 1).getTime(),
        })
        if (generation === dayGeneration) activity.value = rows
    } catch (reason) {
        if (generation === dayGeneration) dayError.value = errorMessage(reason)
    } finally {
        if (generation === dayGeneration) loadingDay.value = false
    }
}
async function move(event: KeyboardEvent) {
    const offsets: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
    const offset = offsets[event.key]
    if (offset === undefined) return
    event.preventDefault()
    const index = visibleDays.findIndex((day) => day.label === selected.value)
    const next = Math.min(visibleDays.length - 1, Math.max(0, index + offset))
    selected.value = visibleDays[next]!.label
    await nextTick()
    heatmapScroll.value?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
}
watch(selected, () => void refreshDay(), { immediate: true })
onMounted(() => {
    const scroll = heatmapScroll.value
    if (scroll) {
        resize = new ResizeObserver(() => {
            const cell = scroll.querySelector('[aria-pressed="true"]')?.getBoundingClientRect()
            if (!cell) return
            const bounds = scroll.getBoundingClientRect()
            if (cell.right > bounds.right) scroll.scrollLeft += cell.right - bounds.right + 4
            else if (cell.left < bounds.left) scroll.scrollLeft += cell.left - bounds.left - 4
        })
        resize.observe(scroll)
    }
    void refresh()
    unsubscribe = onVocabularyChanged(() => {
        void refresh()
        void refreshDay()
    })
})
onBeforeUnmount(() => {
    summaryGeneration++
    dayGeneration++
    unsubscribe?.()
    resize?.disconnect()
})
</script>

<template>
    <header class="page-heading">
        <div>
            <h1>学习统计</h1>
            <p class="muted">查看词汇积累与当前掌握情况</p>
        </div>
    </header>
    <section class="metric-grid">
        <article class="metric-card">
            <span>全部词条</span>
            <div>
                <strong>{{ words.length }}</strong>
                <BookOpen />
            </div>
            <p>本地词库</p>
        </article>
        <article class="metric-card">
            <span>学习中</span>
            <div>
                <strong>{{ learning }}</strong>
                <Bookmark class="orange-text" />
            </div>
            <p>继续在阅读中巩固</p>
        </article>
        <article class="metric-card">
            <span>已掌握</span>
            <div>
                <strong>{{ known }}</strong>
                <Check class="lime-text" />
            </div>
            <p>{{ progress }}% 的词条已掌握</p>
            <div class="progress-track"><span :style="{ width: progress + '%' }"></span></div>
        </article>
        <article class="metric-card">
            <span>已忽略</span>
            <div>
                <strong>{{ ignored }}</strong>
                <EyeOff />
            </div>
            <p>已从生词提示中排除</p>
        </article>
    </section>
    <section class="panel activity-panel">
        <h2>学习活动日历</h2>
        <p class="muted small">
            最近一年 · 当前连续 {{ streaks.current }} 天 · 最长 {{ streaks.longest }} 天
        </p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="loading" class="muted small" role="status">正在读取学习活动…</p>
        <div ref="heatmapScroll" class="heatmap-scroll">
            <div class="heatmap" role="group" aria-label="学习活动热力图" @keydown="move">
                <span
                    v-for="month in months"
                    :key="month.label"
                    class="heatmap-label"
                    :style="{ gridRow: 1, gridColumn: month.column }"
                >
                    {{ month.date.getMonth() + 1 }}月
                </span>
                <span
                    v-for="(day, index) in ['一', '三', '五']"
                    :key="day"
                    class="heatmap-label"
                    :style="{ gridRow: 3 + index * 2, gridColumn: 1 }"
                >
                    {{ day }}
                </span>
                <button
                    v-for="day in visibleDays"
                    :key="day.label"
                    type="button"
                    class="heatmap-cell"
                    :data-intensity="intensity(counts[day.label] ?? 0)"
                    :aria-label="`${day.label} · ${counts[day.label] ?? 0} 个词条`"
                    :title="`${day.label} · ${counts[day.label] ?? 0} 个词条`"
                    :aria-pressed="selected === day.label"
                    :tabindex="selected === day.label ? 0 : -1"
                    :style="{ gridRow: day.row, gridColumn: day.column }"
                    @click="selected = day.label"
                ></button>
            </div>
        </div>
        <div class="heatmap-legend">
            <CalendarDays :size="16" />
            <span>最近一年</span>
            <span class="legend-space"></span>
            <span>少</span>
            <i v-for="level in 5" :key="level" :data-intensity="level - 1"></i>
            <span>多</span>
        </div>
    </section>
    <section class="panel">
        <h2>{{ selected }} 的学习活动</h2>
        <p v-if="dayError" class="error" role="alert">{{ dayError }}</p>
        <p v-else-if="loadingDay" class="muted small" role="status">正在读取当天记录…</p>
        <p v-else-if="!activity.length" class="empty-description">当天没有学习记录。</p>
        <p v-else class="muted small">
            {{ counts[selected] ?? 0 }} 个词条{{ activity.length > 200 ? ' · 显示最近 200 条活动' : '' }}
        </p>
        <div
            v-for="item in loadingDay || dayError ? [] : activity.slice(0, 200)"
            :key="item.id"
            class="activity-row"
        >
            <span class="activity-symbol">
                <Check v-if="item.rating.state === 'known'" :size="18" />
                <Bookmark v-else :size="18" />
            </span>
            <div>
                <strong>{{ wordsByKey.get(item.wordKey) ?? item.wordKey }}</strong>
                <p class="muted small">{{ labels[item.kind] }} · {{ ratingLabel(item.rating) }}</p>
            </div>
            <time :datetime="new Date(item.createdAt).toISOString()">
                {{
                    new Date(item.createdAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                    })
                }}
            </time>
        </div>
    </section>
</template>
