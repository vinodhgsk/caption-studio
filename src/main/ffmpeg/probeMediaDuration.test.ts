import { describe, expect, it } from 'vitest'
import { buildProbeArgs, parseProbeDurationSec } from './probeMediaDuration'

describe('buildProbeArgs', () => {
  it('builds ffprobe args for format duration output', () => {
    const args = buildProbeArgs('/tmp/video.mp4')
    expect(args).toEqual([
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      '/tmp/video.mp4'
    ])
  })
})

describe('parseProbeDurationSec', () => {
  it('parses valid positive duration', () => {
    expect(parseProbeDurationSec('8.000000\n')).toBe(8)
  })

  it('returns null for invalid values', () => {
    expect(parseProbeDurationSec('N/A')).toBeNull()
    expect(parseProbeDurationSec('0')).toBeNull()
    expect(parseProbeDurationSec('-1')).toBeNull()
  })
})
