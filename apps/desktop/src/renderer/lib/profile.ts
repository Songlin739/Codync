/** This account's own name and avatar photo (host `myProfile`/`myProfileSet`, `social::profile`).
 *  `isValidAvatarDataUrl` mirrors the host's own check so the UI can reject an unusable file
 *  before ever sending it over RPC, with the same message the host would otherwise bail with. */
import type { MyProfile } from '@shared/models'
import type { BotStore } from '../store/bot-store'

/** Matches the host's own cap (`social::profile::MAX_AVATAR_LEN`) — kept in sync by hand since
 *  the two sides don't share a constants file; if this drifts, the host's own check still wins. */
export const MAX_AVATAR_DATA_URL_LENGTH = 900_000

export function isValidAvatarDataUrl(dataUrl: string): { ok: true } | { ok: false; reason: string } {
  if (!dataUrl.startsWith('data:image/')) return { ok: false, reason: '头像必须是图片' }
  if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) return { ok: false, reason: '头像文件太大，请换一张小一点的图片' }
  return { ok: true }
}

export async function loadMyProfile(store: BotStore): Promise<MyProfile> {
  const { profile } = await (await store.ready()).call<{ profile: MyProfile }>('myProfile')
  return profile
}

/** `avatar: undefined` leaves the saved avatar untouched; pass `null` explicitly to clear it —
 *  mirroring how `name` already works (omit it and the host doesn't see it in `b["name"]` at
 *  all, versus sending an empty string). `omittedAvatar`/`omittedName` below control that. */
export async function saveMyProfile(store: BotStore, name: string | null, avatar?: string | null): Promise<MyProfile> {
  if (avatar !== undefined && avatar !== null) {
    const check = isValidAvatarDataUrl(avatar)
    if (!check.ok) throw new Error(check.reason)
  }
  const args: Record<string, unknown> = { name }
  if (avatar !== undefined) args.avatar = avatar
  const { profile } = await (await store.ready()).call<{ profile: MyProfile }>('myProfileSet', args)
  return profile
}
