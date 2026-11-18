import { t } from '../i18n'
import { browser } from 'wxt/browser'
import type { DictionaryEntry } from '../domain/models'
import { normalizeWord } from '../domain/vocabulary'

const shards = new Map<string, Record<string, DictionaryEntry>>()
const loading = new Map<string, Promise<Record<string, DictionaryEntry>>>()

async function loadShard(key: string): Promise<Record<string, DictionaryEntry>> {
    const response = await fetch(new URL(`dictionary/${key}.json`, browser.runtime.getURL('/')).href)
    if (!response.ok) throw new Error(t('dictionary.resourceMissing'))
    const shard = (await response.json()) as Record<string, DictionaryEntry>
    if (shards.size >= 3) shards.delete(shards.keys().next().value!)
    shards.set(key, shard)
    return shard
}

export async function lookupDictionary(text: string): Promise<DictionaryEntry | null> {
    const word = normalizeWord(text)
    if (!/^[a-z]/.test(word)) return null
    const shardKey = word[0]!
    let shard = shards.get(shardKey)
    if (!shard) {
        let pending = loading.get(shardKey)
        if (!pending) {
            pending = loadShard(shardKey).finally(() => loading.delete(shardKey))
            loading.set(shardKey, pending)
        }
        shard = await pending
    }
    return Object.hasOwn(shard, word) ? shard[word]! : null
}
