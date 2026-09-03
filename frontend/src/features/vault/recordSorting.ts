import type { RecordSummary } from '../../types'

export type RecordSortField = 'vault' | 'entry_updated' | 'entry_created' | 'account'
export type SortDirection = 'ascending' | 'descending'

const accountCollator = new Intl.Collator(undefined, {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
})

export function filterAndSortRecords(
  records: RecordSummary[],
  query: string,
  field: RecordSortField,
  direction: SortDirection,
): RecordSummary[] {
  const needle = query.trim().toLocaleLowerCase()
  const candidates = records
    .map((record, originalIndex) => ({ record, originalIndex }))
    .filter(({ record }) => !needle || record.account.toLocaleLowerCase().includes(needle))

  if (field === 'vault') {
    const ordered = candidates.map(({ record }) => record)
    return direction === 'ascending' ? ordered : ordered.reverse()
  }

  candidates.sort((left, right) => {
    let comparison: number
    if (field === 'account') {
      comparison = accountCollator.compare(left.record.account, right.record.account)
    } else {
      const timestamp = field === 'entry_created' ? 'created_at' : 'updated_at'
      const leftTime = Date.parse(left.record[timestamp])
      const rightTime = Date.parse(right.record[timestamp])
      const leftInvalid = Number.isNaN(leftTime)
      const rightInvalid = Number.isNaN(rightTime)
      if (leftInvalid || rightInvalid) {
        if (leftInvalid !== rightInvalid) return leftInvalid ? 1 : -1
        return left.originalIndex - right.originalIndex
      }
      comparison = leftTime - rightTime
    }

    if (comparison === 0) return left.originalIndex - right.originalIndex
    return direction === 'ascending' ? comparison : -comparison
  })

  return candidates.map(({ record }) => record)
}

export function sortDirectionLabel(field: RecordSortField, direction: SortDirection): string {
  if (field === 'vault') {
    return direction === 'ascending' ? 'Default: first to last' : 'Default: last to first'
  }
  if (field === 'entry_updated') {
    return direction === 'ascending' ? 'Entry updated: oldest first' : 'Entry updated: newest first'
  }
  if (field === 'entry_created') {
    return direction === 'ascending' ? 'Entry created: oldest first' : 'Entry created: newest first'
  }
  return direction === 'ascending' ? 'Alphabet: A to Z' : 'Alphabet: Z to A'
}
