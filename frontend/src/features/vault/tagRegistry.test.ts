import { describe, expect, it } from 'vitest'

import type { RecordSummary } from '../../types'
import { buildTagRegistry, uniqueTags } from './tagRegistry'

const record = (id: string, tags: string[]): RecordSummary => ({
  id,
  account: id,
  username: '',
  phonenumber: '',
  mail: '',
  date: '',
  url: '',
  tags,
  created_at: '',
  updated_at: '',
  has_custom_fields: false,
})

describe('tag registry', () => {
  it('derives naturally sorted account counts without persisting redundant state', () => {
    expect(buildTagRegistry([
      record('one', ['Tag 10', 'shared', 'shared']),
      record('two', ['Tag 2', ' shared ']),
      record('three', ['', '   ']),
    ])).toEqual([
      { name: 'shared', accountCount: 2 },
      { name: 'Tag 2', accountCount: 1 },
      { name: 'Tag 10', accountCount: 1 },
    ])
  })

  it('trims and de-duplicates tag-picker values while preserving their order', () => {
    expect(uniqueTags([' work ', 'personal', 'work', '', 'personal'])).toEqual(['work', 'personal'])
  })
})
