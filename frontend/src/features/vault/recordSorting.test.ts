import { describe, expect, it } from 'vitest'

import type { RecordSummary } from '../../types'
import { filterAndSortRecords, sortDirectionLabel } from './recordSorting'

const record = (id: string, account: string, updatedAt: string, createdAt: string): RecordSummary => ({
  id,
  account,
  username: '',
  phonenumber: '',
  mail: '',
  date: '',
  url: '',
  tags: [],
  created_at: createdAt,
  updated_at: updatedAt,
  has_custom_fields: false,
})

const records = [
  record('invalid', 'Zulu', 'not-a-date', 'not-a-date'),
  record('ten', 'Account 10', '2026-08-10T00:00:00Z', '2026-08-01T00:00:00Z'),
  record('two', 'Account 2', '2026-08-02T00:00:00Z', '2026-08-20T00:00:00Z'),
  record('alpha-lower', 'alpha', '2026-08-02T00:00:00Z', '2026-08-05T00:00:00Z'),
  record('alpha-upper', 'Alpha', '2026-08-02T00:00:00Z', '2026-08-05T00:00:00Z'),
]

const ids = (items: RecordSummary[]) => items.map(({ id }) => id)

describe('filterAndSortRecords', () => {
  it('preserves vault order by default and reverses it on request', () => {
    expect(ids(filterAndSortRecords(records, '', 'vault', 'ascending'))).toEqual(ids(records))
    expect(ids(filterAndSortRecords(records, '', 'vault', 'descending'))).toEqual(ids(records).reverse())
    expect(ids(records)).toEqual(['invalid', 'ten', 'two', 'alpha-lower', 'alpha-upper'])
  })

  it('sorts account names naturally and preserves vault order for equal names', () => {
    const ascending = ids(filterAndSortRecords(records, '', 'account', 'ascending'))
    const descending = ids(filterAndSortRecords(records, '', 'account', 'descending'))

    expect(ascending.indexOf('two')).toBeLessThan(ascending.indexOf('ten'))
    expect(descending.indexOf('ten')).toBeLessThan(descending.indexOf('two'))
    expect(ascending.indexOf('alpha-lower')).toBeLessThan(ascending.indexOf('alpha-upper'))
    expect(descending.indexOf('alpha-lower')).toBeLessThan(descending.indexOf('alpha-upper'))
  })

  it('sorts valid modification times and always places invalid timestamps last', () => {
    expect(ids(filterAndSortRecords(records, '', 'entry_updated', 'ascending'))).toEqual([
      'two',
      'alpha-lower',
      'alpha-upper',
      'ten',
      'invalid',
    ])
    expect(ids(filterAndSortRecords(records, '', 'entry_updated', 'descending'))).toEqual([
      'ten',
      'two',
      'alpha-lower',
      'alpha-upper',
      'invalid',
    ])
  })

  it('sorts system-generated creation times and always places invalid timestamps last', () => {
    expect(ids(filterAndSortRecords(records, '', 'entry_created', 'ascending'))).toEqual([
      'ten',
      'alpha-lower',
      'alpha-upper',
      'two',
      'invalid',
    ])
    expect(ids(filterAndSortRecords(records, '', 'entry_created', 'descending'))).toEqual([
      'two',
      'alpha-lower',
      'alpha-upper',
      'ten',
      'invalid',
    ])
  })

  it('filters before applying the selected order', () => {
    expect(ids(filterAndSortRecords(records, 'account', 'account', 'ascending'))).toEqual(['two', 'ten'])
  })

  it('requires every selected tag and combines tag filtering with account search', () => {
    const tagged = records.map((item, index) => ({
      ...item,
      tags: index === 1 ? ['work', 'shared'] : index === 2 ? ['work'] : ['shared'],
    }))
    expect(ids(filterAndSortRecords(tagged, '', 'vault', 'ascending', ['work']))).toEqual(['ten', 'two'])
    expect(ids(filterAndSortRecords(tagged, '', 'vault', 'ascending', ['work', 'shared']))).toEqual(['ten'])
    expect(ids(filterAndSortRecords(tagged, 'account', 'account', 'ascending', ['work']))).toEqual(['two', 'ten'])
    expect(ids(filterAndSortRecords(tagged, 'zulu', 'vault', 'ascending', ['work']))).toEqual([])
  })
})

describe('sortDirectionLabel', () => {
  it('describes the active sort direction', () => {
    expect(sortDirectionLabel('vault', 'ascending')).toBe('Default: first to last')
    expect(sortDirectionLabel('entry_updated', 'descending')).toBe('Entry updated: newest first')
    expect(sortDirectionLabel('entry_created', 'ascending')).toBe('Entry created: oldest first')
    expect(sortDirectionLabel('account', 'ascending')).toBe('Alphabet: A to Z')
  })
})
