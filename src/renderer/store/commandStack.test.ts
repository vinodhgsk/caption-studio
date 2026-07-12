import { describe, expect, it } from 'vitest'
import type { Project } from '../../shared/storage'
import {
  type Command,
  canRedo,
  canUndo,
  emptyStack,
  push,
  redo,
  undo
} from './commandStack'

/**
 * Build a minimal `Project` for tests. Only the fields a command touches need
 * realistic values; the rest are filled with benign defaults via a typed
 * factory (no `any`).
 */
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    version: 1,
    id: 'p1',
    name: 'Original',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1920, 1080],
      aspect: '16:9',
      background: '#000000',
      language: 'ta',
      languages: ['ta']
    },
    storage: { location: 'local', root: '/tmp' },
    tracks: [],
    ...overrides
  }
}

/** A pure rename command (apply sets a name, invert restores the previous one). */
function renameCommand(from: string, to: string): Command {
  return {
    label: `Rename to ${to}`,
    apply: (p) => ({ ...p, name: to }),
    invert: (p) => ({ ...p, name: from })
  }
}

/** A pure set-fps command. */
function setFpsCommand(from: number, to: number): Command {
  return {
    label: `Set fps to ${to}`,
    apply: (p) => ({ ...p, settings: { ...p.settings, fps: to } }),
    invert: (p) => ({ ...p, settings: { ...p.settings, fps: from } })
  }
}

describe('commandStack', () => {
  it('emptyStack has no undo and no redo', () => {
    const stack = emptyStack()
    expect(canUndo(stack)).toBe(false)
    expect(canRedo(stack)).toBe(false)
    expect(stack.past).toHaveLength(0)
    expect(stack.future).toHaveLength(0)
  })

  it('push records a command and clears the redo future', () => {
    const doc0 = makeProject()
    const cmd = renameCommand('Original', 'Renamed')

    // Seed a non-empty future by undoing a prior command, then push fresh.
    const seeded = push(emptyStack(), renameCommand('Original', 'A'))
    const afterUndo = undo(seeded, doc0)
    expect(canRedo(afterUndo.stack)).toBe(true)

    const pushed = push(afterUndo.stack, cmd)
    expect(pushed.past).toHaveLength(1)
    expect(pushed.future).toHaveLength(0)
    expect(canRedo(pushed)).toBe(false)
    expect(canUndo(pushed)).toBe(true)
  })

  it('undo then redo round-trips the document back to the same value', () => {
    const doc0 = makeProject({ name: 'Original' })
    const cmd = renameCommand('Original', 'Renamed')

    const stack1 = push(emptyStack(), cmd)
    const doc1 = cmd.apply(doc0)
    expect(doc1.name).toBe('Renamed')

    const undone = undo(stack1, doc1)
    expect(undone.doc.name).toBe('Original')
    expect(undone.doc).toEqual(doc0)
    expect(canUndo(undone.stack)).toBe(false)
    expect(canRedo(undone.stack)).toBe(true)

    const redone = redo(undone.stack, undone.doc)
    expect(redone.doc.name).toBe('Renamed')
    expect(redone.doc).toEqual(doc1)
    expect(canUndo(redone.stack)).toBe(true)
    expect(canRedo(redone.stack)).toBe(false)
  })

  it('walks multiple commands through undo/redo in the correct order', () => {
    const doc0 = makeProject({ name: 'Original', settings: { ...makeProject().settings, fps: 30 } })
    const rename = renameCommand('Original', 'Renamed')
    const setFps = setFpsCommand(30, 60)

    // Apply rename, then set fps.
    let stack = push(emptyStack(), rename)
    const doc1 = rename.apply(doc0)
    stack = push(stack, setFps)
    const doc2 = setFps.apply(doc1)
    expect(doc2.name).toBe('Renamed')
    expect(doc2.settings.fps).toBe(60)

    // Undo set-fps first (LIFO).
    const u1 = undo(stack, doc2)
    expect(u1.doc.settings.fps).toBe(30)
    expect(u1.doc.name).toBe('Renamed')

    // Undo rename next.
    const u2 = undo(u1.stack, u1.doc)
    expect(u2.doc.name).toBe('Original')
    expect(u2.doc).toEqual(doc0)
    expect(canUndo(u2.stack)).toBe(false)

    // Redo rename, then set-fps, returning to doc2.
    const r1 = redo(u2.stack, u2.doc)
    expect(r1.doc.name).toBe('Renamed')
    expect(r1.doc.settings.fps).toBe(30)

    const r2 = redo(r1.stack, r1.doc)
    expect(r2.doc).toEqual(doc2)
    expect(canRedo(r2.stack)).toBe(false)
  })

  it('undo on an empty stack is a no-op', () => {
    const doc0 = makeProject()
    const stack = emptyStack()
    const result = undo(stack, doc0)
    expect(result.stack).toBe(stack)
    expect(result.doc).toBe(doc0)
  })

  it('redo on an empty stack is a no-op', () => {
    const doc0 = makeProject()
    const stack = emptyStack()
    const result = redo(stack, doc0)
    expect(result.stack).toBe(stack)
    expect(result.doc).toBe(doc0)
  })
})
