import { zhCN } from './zh-CN'

export const locale = 'zh-CN'
const messages = zhCN

type MessageKey = keyof typeof zhCN
type Placeholders<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never

export function t<Key extends MessageKey>(
    key: Key,
    ...[values]: Placeholders<(typeof zhCN)[Key]> extends never
        ? []
        : [Record<Placeholders<(typeof zhCN)[Key]>, string | number>]
): string {
    const fields: Readonly<Record<string, string | number>> = values ?? {}
    return messages[key].replace(/\{(\w+)\}/g, (match, name: string) => String(fields[name] ?? match))
}
