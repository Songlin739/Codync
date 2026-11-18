import assert from 'node:assert/strict'
import test from 'node:test'
import { isValidAvatarDataUrl, loadMyProfile, saveMyProfile } from './profile.ts'
import type { MyProfile } from '@shared/models'
import type { BotStore } from '../store/bot-store'

test('a data URL that is not an image is rejected', () => {
  assert.deepEqual(isValidAvatarDataUrl('not-a-data-url'), { ok: false, reason: '头像必须是图片' })
  assert.deepEqual(isValidAvatarDataUrl('data:text/plain;base64,AAEC'), { ok: false, reason: '头像必须是图片' })
})

test('an oversized image data URL is rejected', () => {
  const huge = `data:image/png;base64,${'A'.repeat(1_000_000)}`
  const result = isValidAvatarDataUrl(huge)
  assert.equal(result.ok, false)
})

test('a reasonably small image data URL is accepted', () => {
  assert.deepEqual(isValidAvatarDataUrl('data:image/jpeg;base64,AAEC'), { ok: true })
})

function fakeStore(profile: MyProfile): { store: BotStore; calls: Array<{ method: string; args: unknown }> } {
  const calls: Array<{ method: string; args: unknown }> = []
  let current = profile
  const call = async (method: string, args?: unknown) => {
    calls.push({ method, args })
    if (method === 'myProfile') return { profile: current }
    if (method === 'myProfileSet') {
      const a = (args ?? {}) as Record<string, unknown>
      current = {
        name: 'name' in a ? (a.name as string | null) : current.name,
        avatar: 'avatar' in a ? (a.avatar as string | null) : current.avatar,
      }
      return { profile: current }
    }
    throw new Error(`unexpected method ${method}`)
  }
  return { store: { ready: async () => ({ call }) } as unknown as BotStore, calls }
}

test('loadMyProfile returns whatever the host has on file', async () => {
  const { store } = fakeStore({ name: 'Songlin', avatar: null })
  assert.deepEqual(await loadMyProfile(store), { name: 'Songlin', avatar: null })
})

test('saving a name with no avatar argument never mentions avatar at all', async () => {
  const { store, calls } = fakeStore({ name: null, avatar: 'data:image/jpeg;base64,old' })
  await saveMyProfile(store, 'Songlin')
  const set = calls.find((c) => c.method === 'myProfileSet')!
  assert.deepEqual(set.args, { name: 'Songlin' })
})

test('saving with avatar explicitly null clears it', async () => {
  const { store, calls } = fakeStore({ name: 'Songlin', avatar: 'data:image/jpeg;base64,old' })
  await saveMyProfile(store, 'Songlin', null)
  const set = calls.find((c) => c.method === 'myProfileSet')!
  assert.deepEqual(set.args, { name: 'Songlin', avatar: null })
})

test('saving an invalid avatar throws locally instead of making the RPC call', async () => {
  const { store, calls } = fakeStore({ name: null, avatar: null })
  await assert.rejects(() => saveMyProfile(store, null, 'not-an-image'))
  assert.equal(calls.length, 0)
})
