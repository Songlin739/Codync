import { useEffect, useRef, useState } from 'react'
import { rebase } from '@shared/draft-rebase'
import { AUTO_MODE } from '@shared/approvals'
import { draftOf, isGroup, type Bot, type BotDraft } from '@shared/models'
import { AVATAR_COLORS, AVATAR_SHAPES } from '../../lib/theme'
import type { BotStore } from '../../store/bot-store'

/** An installed connector (host `connectors`). */
export interface InstalledConnector {
  id: string
  name: string
  description: string
  kind: string
  command?: string | null
  url?: string | null
}

/** An installed skill (host `skills`). */
export interface InstalledSkill {
  id: string
  name: string
  description: string
}

export interface Plugins {
  connectors: InstalledConnector[]
  skills: InstalledSkill[]
}

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!

/** A fresh draft: a random look, Claude, a personal workspace, the agent's Auto mode asking about the rest. */
export function newDraft(): BotDraft {
  return { name: '', description: '', avatarColor: pick(AVATAR_COLORS).id, avatarShape: pick(AVATAR_SHAPES), backend: 'claude', cwd: '', permission: 'ask', mode: AUTO_MODE }
}

/** A saved bot keeps a name; only a new one may go without (the host names it after its first conversations). */
export const isValid = (d: BotDraft) => d.name.trim() !== ''

/** What the host should get: no stale command unless the agent is custom. */
export const normalized = (d: BotDraft): BotDraft => (d.backend === 'custom' ? d : { ...d, command: null })

/**
 * Picks an installed agent we know (a registry agent nobody chose is never the default);
 * empty cwd requests a personal workspace from the host. Connectors and skills stay unset:
 * the host turns on every one it can run.
 */
export function fillDefaults(store: BotStore, draft: BotDraft): BotDraft {
  const next = { ...draft }
  const backends = store.hello?.backends ?? []
  const first = backends.find((b) => b.available && b.curated === true)
  if (backends.find((b) => b.id === next.backend)?.available !== true && first) next.backend = first.id
  return next
}

/** The connectors and skills installed on the computer (kit `refreshPlugins`). */
async function loadPlugins(store: BotStore): Promise<Plugins> {
  const client = store.client
  if (!client) return { connectors: [], skills: [] }
  const [c, s] = await Promise.allSettled([
    client.call<{ items: InstalledConnector[] }>('connectors'),
    client.call<{ items: InstalledSkill[] }>('skills'),
  ])
  return { connectors: c.status === 'fulfilled' ? c.value.items : [], skills: s.status === 'fulfilled' ? s.value.items : [] }
}

export function usePlugins(store: BotStore): Plugins | null {
  const [plugins, setPlugins] = useState<Plugins | null>(null)
  const online = store.connection.kind === 'online'
  useEffect(() => {
    let live = true
    void loadPlugins(store).then((p) => live && setPlugins(p))
    return () => {
      live = false
    }
  }, [store, online])
  return plugins
}

/**
 * Keeps an open settings form on the host's copy of its bot: a change made elsewhere (a bot that manages the team,
 * another device) replaces each field the user hasn't edited here, so saving the form never puts back the old value.
 */
export function useFollowSaved(bot: Bot | undefined, change: (update: (d: BotDraft) => BotDraft) => void) {
  const saved = bot ? JSON.stringify(draftOf(bot)) : null
  const last = useRef(saved)
  useEffect(() => {
    const old = last.current
    last.current = saved
    if (!old || !saved || old === saved) return
    const [base, fresh] = [JSON.parse(old) as BotDraft, JSON.parse(saved) as BotDraft]
    if (base.id === fresh.id) change((d) => rebase(d, base, fresh))
  }, [saved])
}

export const lastPathComponent = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The name every group's standing supervisor bot is created and recognized under. */
export const JEV_NAME = 'JEV'

/** JEV's standing instructions: propose a plan, wait for the user's go-ahead, then — with "Manage
 *  the team" on — decide the team itself (how many bots, what each does) and run it, coordinating
 *  members by @-mentioning them in this same group. `manageTeam` is what gives JEV create_bot /
 *  update_bot / add_member; a bot it creates does NOT get that access, or any of JEV's own
 *  connectors (a browser, GitHub…), unless JEV explicitly passes manageTeam: true or
 *  connectors: [...] for that one bot — both bounded by what JEV itself actually has, both
 *  host-enforced rather than merely asked for. JEV's own `permission` (left at the "ask" every
 *  fresh bot starts with) is what still puts an approval card in front of each bot it actually
 *  creates, changes, or adds here — the plan is agreed in chat, but each of those stays something
 *  the user signs off on, one card at a time. */
const JEV_INSTRUCTIONS =
  'You are JEV, this group’s supervisor. You can turn your own answers into a real file whenever that fits ' +
  'better than a chat reply — a PowerPoint, Word or Excel file, using your docx/pptx/xlsx skills. When the ' +
  'user describes a goal or a task, don’t start work yourself: write a short task plan first — how you’d break ' +
  'the work up, how many bots that takes, what each one would do, whether any of them needs one of your own ' +
  'connectors (a browser for web automation, GitHub, Slack…), and how they’d hand off or check in with each ' +
  'other — then ask the user to approve it. Only once they approve, decide the team: for each part, create_bot (leave ' +
  'manageTeam off — an ordinary task-bot should never manage the team; pass connectors only with the specific ' +
  'ones from your own list_team entry that this one task genuinely needs, never all of them by default), then ' +
  'add_member to bring that bot into this same group, then give it its task by @-mentioning it here. Write ' +
  'every bot’s instructions to confine it strictly to that one task in this group: it answers only what you ' +
  'assign, and @-mentions you or a named teammate for a handoff or a question rather than deciding on its own ' +
  'to take on other work. While the team works, review what comes back: catch mistakes, correct them, and ' +
  'revise the plan — reassign a task or create one more bot — rather than redoing everything. If the user ' +
  'changes the goal, treat it as a new plan to approve before you touch the team again.'

/** The anthropics/skills catalog entries that let a bot turn its answer into an actual Office file. */
const DOCUMENT_SKILLS = ['docx', 'pptx', 'xlsx']

/** Installs an anthropics/skills catalog skill (idempotent on the host) and returns its id, or null
 * if the install couldn't be reached right now — never blocks the bot it's for. */
async function ensureSkill(store: BotStore, source: string): Promise<string | null> {
  try {
    const client = await store.ready()
    const { skill } = await client.call<{ skill: { id: string } }>('installSkill', { source })
    return skill.id
  } catch {
    return null
  }
}

/** Every new group gets a standing JEV member: proposes the plan, waits on the user's approval,
 *  then decides and runs the team for it — created once per computer (the first group to need it
 *  makes it) and reused by every group created after. It can turn its own answers into a PPT,
 *  Word or Excel file (the docx/pptx/xlsx skills, installed the first time any group needs JEV). */
export async function ensureJev(store: BotStore): Promise<string> {
  const existing = store.roster.find((b) => !isGroup(b) && b.name === JEV_NAME)
  if (existing) return existing.id
  const draft = fillDefaults(store, newDraft())
  draft.name = JEV_NAME
  draft.description = JEV_INSTRUCTIONS
  draft.manageTeam = true
  draft.mode = AUTO_MODE
  const skillIds = await Promise.all(DOCUMENT_SKILLS.map((source) => ensureSkill(store, source)))
  const granted = skillIds.filter((id): id is string => !!id)
  if (granted.length > 0) draft.skills = granted
  const bot = await store.save(draft)
  await ensureJevLead(store)
  return bot.id
}

/** The name the one account-wide bot that oversees every group's JEV is created and recognized under. */
export const JEV_LEAD_NAME = 'JEV Lead'

/** JEV Lead's standing instructions: once a day, look across every group's JEV and tighten up what
 *  isn't working — it's a reviewer of other JEVs, not a group member or a task-doer itself. */
const JEV_LEAD_INSTRUCTIONS =
  'You are JEV Lead, the one account-wide bot that watches over every group’s JEV supervisor. On your daily ' +
  'routine, use list_team to find every bot named JEV, and for each one look at what it and its group have been ' +
  'doing since you last checked (its chat history, and its group’s): notice mistakes it made, plans that went ' +
  'wrong, or a habit worth fixing — then use update_bot to refine that JEV’s own instructions so it does ' +
  'better next time. Make small, specific corrections tied to something that actually happened, not generic ' +
  'advice. Summarize in your own chat which JEVs you touched and why. You manage the team only to review and ' +
  'correct existing JEV bots: never create a bot, never add yourself or anyone to a group, and leave every ' +
  'other kind of bot alone.'

/** The one JEV Lead for this computer: created once, the first time any group needs its own JEV, with a
 *  daily routine that reviews and corrects every group's JEV. It is never a member of any group itself. */
export async function ensureJevLead(store: BotStore): Promise<string> {
  const existing = store.roster.find((b) => !isGroup(b) && b.name === JEV_LEAD_NAME)
  if (existing) return existing.id
  const draft = fillDefaults(store, newDraft())
  draft.name = JEV_LEAD_NAME
  draft.description = JEV_LEAD_INSTRUCTIONS
  draft.manageTeam = true
  draft.mode = AUTO_MODE
  const bot = await store.save(draft)
  try {
    const client = await store.ready()
    await client.call('saveRoutine', {
      botId: bot.id,
      id: null,
      name: 'Review every JEV',
      instruction: 'Review every group’s JEV and correct what needs it, as your standing instructions describe.',
      schedule: { calendarStyle: 'daily', hour: 9, minute: 0 },
      timeoutSeconds: 1800,
    })
  } catch {
    // The bot still exists without its routine; the user can add one from Routines if this failed.
  }
  return bot.id
}
