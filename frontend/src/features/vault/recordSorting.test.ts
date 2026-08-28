import { describe, expect, it } from 'vitest'

import type { RecordSummary } from '../../types'
import { filterAndSortRecords, sortDirectionLabel } from './recordSorting'

const record = (id: string, account: string, updatedAt: string): RecordSummary => ({
  id,
  account,
  username: '',
  phonenumber: '',
  mail: '',
  date: '',
  url: '',
  tags: [],
  updated_at: updatedAt,
  has_custom_fields: false,
})

const records = [
  record('invalid', 'Zulu', 'not-a-date'),
  record('ten', 'Account 10', '2026-08-10T00:00:00Z'),
  record('two', 'Account 2', '2026-08-02T00:00:00Z'),
  record('alpha-lower', 'alpha', '2026-08-02T00:00:00Z'),
  record('alpha-upper', 'Alpha', '2026-08-02T00:00:00Z'),
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
    expect(ids(filterAndSortRecords(records, '', 'updated', 'ascending'))).toEqual([
      'two',
      'alpha-lower',
      'alpha-upper',
      'ten',
      'invalid',
    ])
    expect(ids(filterAndSortRecords(records, '', 'updated', 'descending'))).toEqual([
      'ten',
      'two',
      'alpha-lower',
      'alpha-upper',
      'invalid',
    ])
  })

  it('filters before applying the selected order', () => {
    expect(ids(filterAndSortRecords(records, 'account', 'account', 'ascending'))).toEqual(['two', 'ten'])
  })
})

describe('sortDirectionLabel', () => {
  it('describes the active sort direction', () => {
    expect(sortDirectionLabel('vault', 'ascending')).toBe('Default: first to last')
    expect(sortDirectionLabel('updated', 'descending')).toBe('Last modified: newest first')
    expect(sortDirectionLabel('account', 'ascending')).toBe('Alphabet: A to Z')
  })
})
