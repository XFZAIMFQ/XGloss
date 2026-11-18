<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Check, Bookmark, EyeOff, CalendarDays } from '@lucide/vue'
import type { Word } from '../domain/models'
const props = defineProps<{ words: Word[] }>()
const known = computed(() => props.words.filter((word) => word.state === 'known').length)
const learning = computed(() => props.words.filter((word) => word.state === 'learning').length)
const ignored = computed(() => props.words.filter((word) => word.state === 'ignored').length)
const progress = computed(() =>
    props.words.length ? Math.round((known.value / props.words.length) * 100) : 0,
)
const days = computed(() => {
    const counts = new Map<string, number>()
    for (const word of props.words) {
        const date = new Date(word.updatedAt).toLocaleDateString('sv-SE')
        counts.set(date, (counts.get(date) ?? 0) + 1)
    }
    const end = new Date()
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 363)
    start.setDate(start.getDate() - start.getDay())
    return Array.from({ length: 371 }, (_, index) => {
        const date = new Date(start)
        date.setDate(start.getDate() + index)
        const label = date.toLocaleDateString('sv-SE')
        return { label, count: counts.get(label) ?? 0, future: date > end }
    })
})
const recent = computed(() =>
    [...props.words].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 8),
)
const labels = { known: '已掌握', learning: '学习中', ignored: '已忽略' }
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
        <h2>词汇更新日历</h2>
        <p class="muted small">按词条最近一次修改日期汇总</p>
        <div class="heatmap-scroll">
            <div class="heatmap">
                <span
                    v-for="day in days"
                    :key="day.label"
                    :title="`${day.label} · ${day.count} 个词条`"
                    :class="{ 'heatmap-active': day.count > 0, 'heatmap-future': day.future }"
                    :style="day.count ? { opacity: Math.min(1, 0.4 + day.count / 10) } : undefined"
                ></span>
            </div>
        </div>
        <div class="heatmap-legend">
            <CalendarDays :size="16" />
            <span>最近一年</span>
            <span class="legend-space"></span>
            <span>少</span>
            <i></i>
            <i></i>
            <i></i>
            <span>多</span>
        </div>
    </section>
    <section class="panel">
        <h2>最近更新</h2>
        <p v-if="!recent.length" class="empty-description">收藏单词后，可以在这里查看词汇更新。</p>
        <div v-for="word in recent" :key="word.key" class="activity-row">
            <span class="activity-symbol">
                <Check v-if="word.state === 'known'" :size="18" />
                <Bookmark v-else :size="18" />
            </span>
            <div>
                <strong>{{ word.text }}</strong>
                <p class="muted small">{{ labels[word.state] }}</p>
            </div>
            <time>{{ new Date(word.updatedAt).toLocaleDateString() }}</time>
        </div>
    </section>
</template>
