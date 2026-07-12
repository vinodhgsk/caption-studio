/**
 * Tests for the CTC forced-alignment sidecar RUNNER (not the Python engine).
 *
 * The real sidecar needs torch/torchaudio, so these use a tiny Node script as a
 * stand-in "python" to exercise spawn/stdin/stdout/parsing and every failure
 * path (missing sidecar, non-zero exit, {ok:false}, empty words) — all of which
 * must resolve to null so the caller degrades to VAD phrase-sync.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execPath } from 'node:process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSidecar, runForcedAlign } from './forcedAlign'

let dir = ''
const scripts: Record<string, string> = {}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'falign-'))
  // A stub that echoes a valid alignment for however many words it receives.
  scripts.ok = join(dir, 'ok.js')
  writeFileSync(
    scripts.ok,
    `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{
       const req=JSON.parse(s);
       const words=req.words.map((_,i)=>({start:i,end:i+0.5,score:0.9}));
       process.stdout.write(JSON.stringify({ok:true,sample_rate:16000,words}));
     });`
  )
  scripts.fail = join(dir, 'fail.js')
  writeFileSync(scripts.fail, `process.exit(2);`)
  scripts.notok = join(dir, 'notok.js')
  writeFileSync(scripts.notok, `process.stdout.write(JSON.stringify({ok:false,error:"deps"}));`)
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('resolveSidecar', () => {
  it('returns null when the python or script path does not exist', () => {
    const prevPy = process.env.CAPTION_STUDIO_ALIGN_PY
    const prevScript = process.env.CAPTION_STUDIO_ALIGN_SCRIPT
    process.env.CAPTION_STUDIO_ALIGN_PY = join(dir, 'nope-python')
    process.env.CAPTION_STUDIO_ALIGN_SCRIPT = join(dir, 'nope.js')
    expect(resolveSidecar('/whatever')).toBeNull()
    if (prevPy === undefined) delete process.env.CAPTION_STUDIO_ALIGN_PY
    else process.env.CAPTION_STUDIO_ALIGN_PY = prevPy
    if (prevScript === undefined) delete process.env.CAPTION_STUDIO_ALIGN_SCRIPT
    else process.env.CAPTION_STUDIO_ALIGN_SCRIPT = prevScript
  })
})

describe('runForcedAlign', () => {
  const withStub = async (scriptKey: keyof typeof scripts, words: string[]) => {
    const prevPy = process.env.CAPTION_STUDIO_ALIGN_PY
    const prevScript = process.env.CAPTION_STUDIO_ALIGN_SCRIPT
    process.env.CAPTION_STUDIO_ALIGN_PY = execPath // node acts as "python"
    process.env.CAPTION_STUDIO_ALIGN_SCRIPT = scripts[scriptKey]
    try {
      return await runForcedAlign({ wavAbsPath: '/x.wav', words, language: 'ta', appRoot: dir })
    } finally {
      if (prevPy === undefined) delete process.env.CAPTION_STUDIO_ALIGN_PY
      else process.env.CAPTION_STUDIO_ALIGN_PY = prevPy
      if (prevScript === undefined) delete process.env.CAPTION_STUDIO_ALIGN_SCRIPT
      else process.env.CAPTION_STUDIO_ALIGN_SCRIPT = prevScript
    }
  }

  it('parses a valid sidecar response into per-word timings', async () => {
    const res = await withStub('ok', ['a', 'b', 'c'])
    expect(res).not.toBeNull()
    expect(res!.sampleRate).toBe(16000)
    expect(res!.words).toHaveLength(3)
    expect(res!.words[1]).toEqual({ start: 1, end: 1.5, score: 0.9 })
  })

  it('returns null on empty word list (nothing to align)', async () => {
    expect(await withStub('ok', [])).toBeNull()
  })

  it('returns null when the sidecar exits non-zero', async () => {
    expect(await withStub('fail', ['a'])).toBeNull()
  })

  it('returns null when the sidecar reports {ok:false}', async () => {
    expect(await withStub('notok', ['a'])).toBeNull()
  })

  it('returns null when the sidecar is not installed', async () => {
    const prevPy = process.env.CAPTION_STUDIO_ALIGN_PY
    const prevScript = process.env.CAPTION_STUDIO_ALIGN_SCRIPT
    process.env.CAPTION_STUDIO_ALIGN_PY = join(dir, 'missing')
    process.env.CAPTION_STUDIO_ALIGN_SCRIPT = join(dir, 'missing.js')
    const res = await runForcedAlign({ wavAbsPath: '/x.wav', words: ['a'], appRoot: dir })
    expect(res).toBeNull()
    if (prevPy === undefined) delete process.env.CAPTION_STUDIO_ALIGN_PY
    else process.env.CAPTION_STUDIO_ALIGN_PY = prevPy
    if (prevScript === undefined) delete process.env.CAPTION_STUDIO_ALIGN_SCRIPT
    else process.env.CAPTION_STUDIO_ALIGN_SCRIPT = prevScript
  })
})
