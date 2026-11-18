import { browser } from 'wxt/browser'
import type { DictionaryEntry } from '../domain/models'
import { normalizeWord } from '../domain/vocabulary'

const shards = new Map<string, Record<string, DictionaryEntry>>()

export async function lookupDictionary(text: string): Promise<DictionaryEntry | null> {
    const word = normalizeWord(text)
    if (!/^[a-z]/.test(word)) return null
    const shardKey = word[0]!
    let shard = shards.get(shardKey)
    if (!shard) {
        const response = await fetch(new URL(`dictionary/${shardKey}.json`, browser.runtime.getURL('/')).href)
        if (!response.ok)
            throw new Error('本地词典资源尚未准备，请运行 npm run dictionary:prepare 后重新构建')
        shard = (await response.json()) as Record<string, DictionaryEntry>
        if (shards.size >= 3) shards.delete(shards.keys().next().value!)
        shards.set(shardKey, shard)
    }
    return Object.hasOwn(shard, word) ? shard[word]! : null
}
