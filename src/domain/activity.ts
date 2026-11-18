import type { LearningActivity } from './models'

export function localDay(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function summarizeActivity(activities: LearningActivity[]): Record<string, number> {
    const daily = new Map<string, Set<string>>()
    for (const activity of activities) {
        const key = localDay(new Date(activity.createdAt))
        const words = daily.get(key) ?? new Set<string>()
        words.add(activity.wordKey)
        daily.set(key, words)
    }
    return Object.fromEntries([...daily].map(([key, words]) => [key, words.size]))
}

export function activityStreaks(counts: Record<string, number>, start: Date, today: Date) {
    let current = 0
    let longest = 0
    for (const day = new Date(start); day <= today; day.setDate(day.getDate() + 1)) {
        if (counts[localDay(day)]) {
            current++
            longest = Math.max(longest, current)
        } else if (localDay(day) !== localDay(today)) {
            current = 0
        }
    }
    return { current, longest }
}
