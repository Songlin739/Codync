import type { BotStore } from '../store/bot-store'
import { decodeCode, encodeCode } from './base64.ts'

/** What the host's `exportSkill`/`importSkill` pass around — mirrors `market::SkillPackage` on
 *  the Rust side: a skill's name, description, and every file in its directory. */
export interface SkillPackage {
  name: string
  description: string
  files: [string, number[]][]
}

/** Installed skill (`host `skills`), as returned by `importSkill`/`exportSkill`. */
export interface SharedSkill {
  id: string
  name: string
  description: string
  source: string
}

/**
 * Packages one of this account's own skills (`skillId`) into a single copyable code — the same
 * paste-a-code flow friends already use to add each other (`FriendsPanel`'s invite codes),
 * standing in for the group's P2P data channel until that's wired up (see `p2p-signal.ts`).
 */
export async function exportSkillCode(store: BotStore, skillId: string): Promise<string> {
  const { package: pkg } = await (await store.ready()).call<{ package: SkillPackage }>('exportSkill', { id: skillId })
  return encodeCode(pkg)
}

/** Decodes a code without importing it yet — so the UI can show what it's about to install and,
 *  if the name collides with something already there, ask the user how to resolve it first. */
export function previewSkillCode(code: string): SkillPackage {
  const pkg = decodeCode<SkillPackage>(code)
  if (typeof pkg.name !== 'string' || !Array.isArray(pkg.files)) throw new Error('这不是一个有效的 skill 分享码')
  return pkg
}

/** Imports a previewed package. `overwrite` only matters if its name collides with an existing
 *  skill — the caller decides that (typically by asking the user) before calling this. */
export async function importSkillCode(store: BotStore, pkg: SkillPackage, overwrite: boolean): Promise<SharedSkill> {
  const { skill } = await (await store.ready()).call<{ skill: SharedSkill }>('importSkill', { package: pkg, overwrite })
  return skill
}
