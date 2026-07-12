import type { Project } from '../../shared/storage'

/**
 * A single undoable edit over the open project document. Commands are pure
 * transform pairs: `apply` produces the next document, `invert` reverses it.
 * Both must return a NEW `Project` (no in-place mutation) so history stays
 * immutable and replayable. `label` is human-readable (for menus/tooltips).
 */
export interface Command {
  label: string
  apply: (p: Project) => Project
  invert: (p: Project) => Project
}

/**
 * The command stack: `past` holds applied commands (most recent last), `future`
 * holds undone commands available for redo (next-to-redo last). This module is
 * pure — it owns all the branching/edge logic and never touches a store.
 */
export interface CommandStack {
  past: Command[]
  future: Command[]
}

/** A fresh, empty stack (no undo/redo available). */
export function emptyStack(): CommandStack {
  return { past: [], future: [] }
}

/**
 * Record a newly-applied command. Pushing a command clears the redo `future`
 * (a new edit forks history). Does NOT apply the command — callers run
 * `cmd.apply` on the document themselves.
 */
export function push(stack: CommandStack, cmd: Command): CommandStack {
  return { past: [...stack.past, cmd], future: [] }
}

/** True when there is at least one command to undo. */
export function canUndo(stack: CommandStack): boolean {
  return stack.past.length > 0
}

/** True when there is at least one command to redo. */
export function canRedo(stack: CommandStack): boolean {
  return stack.future.length > 0
}

/**
 * Undo the most recent command against `doc`: pop it from `past`, push it onto
 * `future`, and return the inverted document. A no-op (same stack + doc) when
 * `past` is empty.
 */
export function undo(stack: CommandStack, doc: Project): { stack: CommandStack; doc: Project } {
  if (stack.past.length === 0) return { stack, doc }
  const cmd = stack.past[stack.past.length - 1]
  return {
    stack: { past: stack.past.slice(0, -1), future: [...stack.future, cmd] },
    doc: cmd.invert(doc)
  }
}

/**
 * Redo the most recently undone command against `doc`: pop it from `future`,
 * push it back onto `past`, and return the re-applied document. A no-op (same
 * stack + doc) when `future` is empty.
 */
export function redo(stack: CommandStack, doc: Project): { stack: CommandStack; doc: Project } {
  if (stack.future.length === 0) return { stack, doc }
  const cmd = stack.future[stack.future.length - 1]
  return {
    stack: { past: [...stack.past, cmd], future: stack.future.slice(0, -1) },
    doc: cmd.apply(doc)
  }
}
