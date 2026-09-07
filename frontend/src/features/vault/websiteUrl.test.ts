import { describe, expect, it } from 'vitest'

import { externalWebsiteUrl } from './websiteUrl'

describe('externalWebsiteUrl', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['http://example.com/path', 'http://example.com/path'],
    ['javascript:alert(1)', null],
    ['ftp://example.com', null],
    ['not a URL', null],
  ])('allows only absolute HTTP website links (%s)', (value, expected) => {
    expect(externalWebsiteUrl(value)).toBe(expected)
  })
})
