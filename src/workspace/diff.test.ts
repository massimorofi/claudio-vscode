import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// diff.ts imports the vscode module at load time (for showProposedDiff); the
// pure builder under test doesn't use it, so stub the module out.
vi.mock('vscode', () => ({
  Uri: { file: (p: string) => p },
  workspace: {},
  commands: { executeCommand: () => undefined },
}))

import { buildProposedWrite } from './diff'

let tmp: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-diff-'))
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('buildProposedWrite', () => {
  it('write_file produces the full content', () => {
    const res = buildProposedWrite(
      'write_file',
      JSON.stringify({ path: 'a.txt', content: 'hello' }),
      tmp,
    )
    expect(res).toEqual({ path: path.resolve(tmp, 'a.txt'), content: 'hello' })
  })

  it('write_file with append concatenates the current file', () => {
    const file = path.join(tmp, 'append.txt')
    fs.writeFileSync(file, 'one\n')
    const res = buildProposedWrite(
      'write_file',
      JSON.stringify({ path: 'append.txt', content: 'two\n', append: true }),
      tmp,
    )
    expect(res).toEqual({ path: file, content: 'one\ntwo\n' })
  })

  it('edit_file replaces the first occurrence', () => {
    const file = path.join(tmp, 'edit.txt')
    fs.writeFileSync(file, 'foo bar foo')
    const res = buildProposedWrite(
      'edit_file',
      JSON.stringify({ path: 'edit.txt', old_string: 'foo', new_string: 'baz' }),
      tmp,
    )
    expect(res).toEqual({ path: file, content: 'baz bar foo' })
  })

  it('edit_file with replace_all replaces every occurrence', () => {
    const file = path.join(tmp, 'all.txt')
    fs.writeFileSync(file, 'foo bar foo')
    const res = buildProposedWrite(
      'edit_file',
      JSON.stringify({
        path: 'all.txt',
        old_string: 'foo',
        new_string: 'baz',
        replace_all: true,
      }),
      tmp,
    )
    expect(res).toEqual({ path: file, content: 'baz bar baz' })
  })

  it('edit_file on a missing file returns null', () => {
    const res = buildProposedWrite(
      'edit_file',
      JSON.stringify({ path: 'nope.txt', old_string: 'x', new_string: 'y' }),
      tmp,
    )
    expect(res).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(buildProposedWrite('write_file', '{not json', tmp)).toBeNull()
  })

  it('returns null when path is missing', () => {
    expect(buildProposedWrite('write_file', JSON.stringify({ content: 'x' }), tmp)).toBeNull()
  })

  it('returns null for an unrecognised tool', () => {
    expect(
      buildProposedWrite('run_command', JSON.stringify({ path: 'x', content: 'y' }), tmp),
    ).toBeNull()
  })

  it('write_file without content returns null', () => {
    expect(buildProposedWrite('write_file', JSON.stringify({ path: 'x' }), tmp)).toBeNull()
  })
})
