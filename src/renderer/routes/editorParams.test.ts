import { describe, expect, it } from 'vitest'
import { parseEditorParams } from './editorParams'

describe('parseEditorParams', () => {
  it('returns narrowed params for a valid local id', () => {
    const params = new URLSearchParams('id=abc&location=local')
    expect(parseEditorParams(params)).toEqual({ id: 'abc', location: 'local' })
  })

  it('accepts onedrive as a location', () => {
    const params = new URLSearchParams('id=xyz&location=onedrive')
    expect(parseEditorParams(params)).toEqual({ id: 'xyz', location: 'onedrive' })
  })

  it('rejects an unknown location', () => {
    const params = new URLSearchParams('id=abc&location=dropbox')
    expect(parseEditorParams(params)).toBeNull()
  })

  it('rejects a missing location', () => {
    const params = new URLSearchParams('id=abc')
    expect(parseEditorParams(params)).toBeNull()
  })

  it('rejects a missing id', () => {
    const params = new URLSearchParams('location=local')
    expect(parseEditorParams(params)).toBeNull()
  })

  it('rejects an empty id', () => {
    const params = new URLSearchParams('id=&location=local')
    expect(parseEditorParams(params)).toBeNull()
  })
})
