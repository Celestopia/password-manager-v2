import type { RecordSummary } from '../../types'

export interface TagSummary {
  name: string
  accountCount: number
}

const tagCollator = new Intl.Collator(undefined, {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
})

export function buildTagRegistry(records: RecordSummary[]): TagSummary[] {
  const counts = new Map<string, number>()
  records.forEach((record) => {
    const accountTags = new Set(record.tags.map((tag) => tag.trim()).filter(Boolean))
    accountTags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1))
  })
  return Array.from(counts, ([name, accountCount]) => ({ name, accountCount }))
    .sort((left, right) => tagCollator.compare(left.name, right.name))
}

export function uniqueTags(tags: string[]): string[] {
  const result: string[] = []
  tags.forEach((value) => {
    const tag = value.trim()
    if (tag && !result.includes(tag)) result.push(tag)
  })
  return result
}
