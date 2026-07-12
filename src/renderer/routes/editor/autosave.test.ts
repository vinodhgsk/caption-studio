import { describe, expect, it } from 'vitest'
import { shouldAutosave } from './autosave'

describe('shouldAutosave', () => {
  it('fires when dirty, project open, and not currently saving', () => {
    expect(shouldAutosave(true, 'idle', true)).toBe(true)
    expect(shouldAutosave(true, 'saved', true)).toBe(true)
    expect(shouldAutosave(true, 'error', true)).toBe(true)
  })

  it('does not fire when not dirty', () => {
    expect(shouldAutosave(false, 'idle', true)).toBe(false)
  })

  it('does not fire when no project is open', () => {
    expect(shouldAutosave(true, 'idle', false)).toBe(false)
  })

  it('does not fire while a save is in flight', () => {
    expect(shouldAutosave(true, 'saving', true)).toBe(false)
  })
})
