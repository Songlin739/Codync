import assert from 'node:assert/strict'
import test from 'node:test'
import { base64ToBytes, bytesToBase64, decodeCode, encodeCode } from './base64.ts'

test('bytes round-trip through base64, including non-printable values', () => {
  const bytes = new Uint8Array([0, 1, 2, 255, 254, 128, 42])
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes)
})

test('a JSON value with non-Latin1 characters round-trips through a code', () => {
  const value = { name: '我的技能', files: [['SKILL.md', [1, 2, 3]]] }
  assert.deepEqual(decodeCode(encodeCode(value)), value)
})

test('decodeCode trims surrounding whitespace, as a pasted code often has', () => {
  const code = encodeCode({ ok: true })
  assert.deepEqual(decodeCode(`  ${code}\n`), { ok: true })
})
