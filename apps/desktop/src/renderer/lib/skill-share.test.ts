import assert from 'node:assert/strict'
import test from 'node:test'
import type { BotStore } from '../store/bot-store'
import { exportSkillCode, importSkillCode, previewSkillCode, type SharedSkill, type SkillPackage } from './skill-share.ts'

function fakeStore(): { store: BotStore; imported: { package: SkillPackage; overwrite: boolean }[] } {
  const imported: { package: SkillPackage; overwrite: boolean }[] = []
  const call = async <T>(method: string, args: Record<string, unknown>): Promise<T> => {
    if (method === 'exportSkill') {
      const pkg: SkillPackage = { name: '我的技能', description: '说明', files: [['SKILL.md', [1, 2, 3]]] }
      return { package: pkg } as T
    }
    if (method === 'importSkill') {
      const entry = { package: args.package as SkillPackage, overwrite: args.overwrite as boolean }
      imported.push(entry)
      const skill: SharedSkill = { id: 'new-id', name: entry.package.name, description: entry.package.description, source: 'friend' }
      return { skill } as T
    }
    throw new Error(`unexpected call: ${method}`)
  }
  const store = { ready: async () => ({ call }) } as unknown as BotStore
  return { store, imported }
}

test('a skill exports to a code that previews back to the same package', async () => {
  const { store } = fakeStore()
  const code = await exportSkillCode(store, 'sk1')
  const preview = previewSkillCode(code)
  assert.equal(preview.name, '我的技能')
  assert.equal(preview.description, '说明')
  assert.deepEqual(preview.files, [['SKILL.md', [1, 2, 3]]])
})

test('previewing a garbled code fails clearly instead of importing something broken', () => {
  assert.throws(() => previewSkillCode('not-a-real-code'))
})

test('importing passes the overwrite choice straight through to the host', async () => {
  const { store, imported } = fakeStore()
  const code = await exportSkillCode(store, 'sk1')
  const pkg = previewSkillCode(code)

  const skill = await importSkillCode(store, pkg, true)
  assert.equal(skill.name, '我的技能')
  assert.equal(imported.length, 1)
  assert.equal(imported[0]!.overwrite, true)
})
