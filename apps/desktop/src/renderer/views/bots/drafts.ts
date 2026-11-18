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

/** A group's six standing roles. `jev` is its supervisor and sole contact for the user; the other
 *  five report to it (`habits` sits outside that loop — see its instructions below). Each role's bot
 *  is named `{label}·{groupName}`, never shared across groups, so a group's own JEV is never confused
 *  with another's. */
const ROLES = {
  jev: 'JEV',
  flow: '流程审核',
  effect: '效果审核',
  review: '复核评估',
  habits: '习惯观察',
  docs: '文档生成',
} as const

/** A role's name within one group: `JEV·Launch plan`, etc. Exported so the group-rename flow
 *  (`renameGroupRoster`) can recognize and follow it. */
export const named = (role: string, groupName: string): string => (groupName.trim() ? `${role}·${groupName.trim()}` : role)

const ROLE_LABELS: readonly string[] = Object.values(ROLES)

/** The role a standing bot's current name says it plays in its group, or null for a bot the user
 *  added by hand (it keeps whatever name it already had). */
function roleOf(botName: string): string | null {
  const cut = botName.indexOf('·')
  if (cut <= 0) return null
  const role = botName.slice(0, cut)
  return ROLE_LABELS.includes(role) ? role : null
}

/** The performance-discipline clause every standing bot gets except `habits` (which is exempt by design —
 *  see its own instructions) — and that JEV must also hand to any task bot it creates later via create_bot. */
const PERFORMANCE_CLAUSE =
  'Hold yourself to whatever task metrics your group’s JEV has set for this work; never cut a corner to get ' +
  'there faster. If a reviewer finds you short of the target, don’t just patch the one thing they flagged — go ' +
  'back, work out why you fell short, and redo it until the result clears the target, not just meets it.'

const PERFORMANCE_CLAUSE_FOR_JEV =
  'This same discipline applies to any task bot you create yourself: write its instructions to hold it to ' +
  'whatever metric you set for its task, with no corner-cutting, and to redo its work until it clears that ' +
  'target — not just meets it — whenever a review finds it short.'

/** JEV's standing instructions for its own group: propose a plan, wait for the user's go-ahead, then run
 *  the standing team (and, with "Manage the team" on, any task bots the plan needs) by @-mentioning members
 *  in this same group. `manageTeam` is what gives JEV create_bot/update_bot/add_member; a bot it creates
 *  does NOT get that access, or any of JEV's own connectors, unless JEV explicitly grants it for that one
 *  bot — bounded by what JEV itself has, host-enforced rather than merely asked for. */
function jevInstructions(groupName: string): string {
  const docs = named(ROLES.docs, groupName)
  const flow = named(ROLES.flow, groupName)
  const effect = named(ROLES.effect, groupName)
  const review = named(ROLES.review, groupName)
  const habits = named(ROLES.habits, groupName)
  return (
    `You are ${named(ROLES.jev, groupName)}, this group’s supervisor. The user talks to you alone here — ` +
    `your five standing teammates (${flow}, ${effect}, ${review}, ${habits}, ${docs}) never answer the user ` +
    'directly, even if the user @mentions or replies to one by mistake; that is enforced for you, not just asked. ' +
    `Any file the group needs — PowerPoint, Word, Excel, or a video — is ${docs}’s job, never yours: hand it the ` +
    'content and let it produce the file; don’t try to generate documents yourself. When the user describes a ' +
    'goal or a task, don’t start work yourself: write a short task plan — what each of your five teammates will ' +
    `do, what you’ll measure their work against, and whether this needs any task bot beyond them — then ask the ` +
    'user to approve it. Once approved, assign the work by @-mentioning your teammates here. The working order is: ' +
    `${docs} produces a draft or a file; ${flow}, ${effect} and ${review} each check their own slice of it and, if ` +
    `they find a problem, @mention ${docs} directly to get it fixed — don’t route that through you, it’s faster ` +
    `without you in the loop. Only once all three have signed off does the group tell you "this version passed," ` +
    `and only then do you report up to the user. ${habits} sits outside all of this: it continuously watches how ` +
    'you assign work, how the others carry it out, the quality of what comes back, and the user’s own corrections ' +
    'and preferences as the work proceeds, and reports you a habit profile from time to time — read it and adjust ' +
    `how you run this group. ${PERFORMANCE_CLAUSE_FOR_JEV} While the team works, review what comes back: catch ` +
    'mistakes, correct them, and revise the plan — reassign a task or create one more bot — rather than redoing ' +
    'everything yourself. If the user changes the goal, treat it as a new plan to approve before you touch the ' +
    'team again.'
  )
}

/** The anthropics/skills catalog entries that let a bot turn its answer into an actual file. There is
 *  no video-producing skill in that catalog as of 2026-11 (checked against the live repo tree — no
 *  `video` or `video-making` folder under `skills/`), so this group no longer tries one: the earlier
 *  attempt (`ensureFirstSkill` over `['video', 'video-making']`) always 404'd and silently fell back to
 *  null. Re-add a video entry here once the catalog actually publishes one. */
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

/** The model a role should run on, by keyword match against what the selected computer's agent actually
 *  offers (`agentModels`) — never a guessed id. Every JEV and `habits` run Fable 5.2; everyone else,
 *  including JEV's own later task bots, run Opus 5.5. Null (the agent's own default) if the live catalog
 *  has no match, rather than sending an id that might not exist on this backend. Exported so
 *  `group-tasks.ts` can pick the same way for a claimed work-bot task. */
export async function pickModel(store: BotStore, backend: string, keyword: string): Promise<string | null> {
  try {
    const client = await store.ready()
    const catalog = await client.call<{ models: { id: string; name: string }[] }>('agentModels', { backend })
    const hit = catalog.models.find((m) => m.id.toLowerCase().includes(keyword) || m.name.toLowerCase().includes(keyword))
    return hit?.id ?? null
  } catch {
    return null
  }
}

/** Builds one standing-role draft: a fresh look, this group's naming, the given instructions, model and
 *  extras — but not yet saved. */
function roleDraft(store: BotStore, role: string, groupName: string, instructions: string): BotDraft {
  const draft = fillDefaults(store, newDraft())
  draft.name = named(role, groupName)
  draft.description = instructions
  draft.mode = AUTO_MODE
  return draft
}

/**
 * Creates a new group's full standing roster — JEV plus the five standard reviewers — named and wired
 * for `groupName`, and returns their ids with JEV first. Nothing is reused across groups: every group
 * gets its own six bots, so two groups' JEVs (or any other role) are never the same bot and never
 * confusable in a picker.
 */
export async function createGroupRoster(store: BotStore, groupName: string): Promise<string[]> {
  const sample = fillDefaults(store, newDraft())
  const [fableId, opusId, docSkillIds] = await Promise.all([
    pickModel(store, sample.backend, 'fable'),
    pickModel(store, sample.backend, 'opus'),
    Promise.all(DOCUMENT_SKILLS.map((source) => ensureSkill(store, source))),
  ])
  const docs = named(ROLES.docs, groupName)
  const flow = named(ROLES.flow, groupName)
  const effect = named(ROLES.effect, groupName)
  const review = named(ROLES.review, groupName)
  const habits = named(ROLES.habits, groupName)
  const jev = named(ROLES.jev, groupName)

  const jevDraft = roleDraft(store, ROLES.jev, groupName, jevInstructions(groupName))
  jevDraft.manageTeam = true
  jevDraft.model = fableId

  const flowDraft = roleDraft(
    store,
    ROLES.flow,
    groupName,
    `You are ${flow}. You review ${docs}’s output for process compliance — did the group follow the plan ` +
      `${jev} approved, the right steps in the right order, nothing skipped. If you find a problem, @mention ` +
      `${docs} directly with exactly what to fix; once it’s fixed and you’re satisfied, say so in the group ` +
      `so the version can move toward sign-off. Don’t fix it yourself and don’t go around ${jev} for anything ` +
      `other than this review. ${PERFORMANCE_CLAUSE}`,
  )
  flowDraft.model = opusId

  const effectDraft = roleDraft(
    store,
    ROLES.effect,
    groupName,
    `You are ${effect}. You review ${docs}’s output for whether it actually works — does it meet the goal ` +
      `${jev} set, is the quality there, does it hold up, not just "did the steps get followed." If you find ` +
      `a problem, @mention ${docs} directly with exactly what to fix; once it’s fixed and you’re satisfied, say ` +
      `so in the group so the version can move toward sign-off. ${PERFORMANCE_CLAUSE}`,
  )
  effectDraft.model = opusId

  const reviewDraft = roleDraft(
    store,
    ROLES.review,
    groupName,
    `You are ${review}. Once ${flow} and ${effect} have both signed off, you do a final independent pass over ` +
      `${docs}’s output: re-check their conclusions rather than taking them on faith, judge how serious any ` +
      `remaining issue actually is, and if something still needs fixing, propose the fix yourself and ` +
      `@mention ${docs} with it. Only once you're satisfied does the group tell ${jev} this version passed. ` +
      `You have no in-group reviewer of your own — your work is checked by the user and by JEV Lead, the ` +
      `account-wide bot that reviews every group’s JEV. ${PERFORMANCE_CLAUSE}`,
  )
  reviewDraft.model = opusId

  const habitsDraft = roleDraft(
    store,
    ROLES.habits,
    groupName,
    `You are ${habits}. You are the one standing role fully outside this group’s task-review loop — you ` +
      `never check anyone's work and are never a stop on the way to sign-off. Instead you continuously observe ` +
      `the whole group’s working process: how ${jev} assigns and runs tasks, how ${flow}, ${effect}, ${review} ` +
      `and ${docs} each actually go about their own work (including each one's own habits, not just the ` +
      `group's as a whole), and the user’s own adjustments, corrections and preferences as they come up. From ` +
      `that, build up a running picture of the user’s working habits and preferences, and report it to ${jev} ` +
      `from time to time so ${jev} can learn from it and run the group better. You are exempt from the ` +
      'performance-discipline clause the other roles follow: your job is to watch and summarize, not to hit a task metric.',
  )
  habitsDraft.model = fableId

  const docsDraft = roleDraft(
    store,
    ROLES.docs,
    groupName,
    `You are ${docs}, this group’s sole document- and file-output bot — PowerPoint, Word, Excel, and (where ` +
      `it actually works) video, using your docx/pptx/xlsx skills and whatever video skill you have. ${jev} ` +
      `and the rest of the group hand you content and tell you what to produce; you turn it into the actual ` +
      `file. When ${flow}, ${effect} or ${review} @mention you with a problem, fix it directly and reply in ` +
      `the group when it's done — you don't need to go through ${jev} for that. You also have permission to ` +
      'operate the RStudio desktop application directly (screenshots, clicks, typing) for any data-analysis ' +
      `work the group needs: open or switch to RStudio, drive its console and scripts, and bring back the ` +
      `results. ${PERFORMANCE_CLAUSE}`,
  )
  docsDraft.model = opusId
  docsDraft.computer = true
  const skillIds = docSkillIds.filter((id): id is string => !!id)
  if (skillIds.length > 0) docsDraft.skills = skillIds

  const [jevBot, flowBot, effectBot, reviewBot, habitsBot, docsBot] = await Promise.all([
    store.save(jevDraft),
    store.save(flowDraft),
    store.save(effectDraft),
    store.save(reviewDraft),
    store.save(habitsDraft),
    store.save(docsDraft),
  ])
  await ensureJevLead(store)
  return [jevBot.id, flowBot.id, effectBot.id, reviewBot.id, habitsBot.id, docsBot.id]
}

/** Keeps a group's six standing role-bots named in step with the group's own name (`JEV·{name}`, etc.) —
 *  call once a group rename itself has been saved. Best-effort: a bot whose name doesn't match the
 *  `{role}·{oldName}` pattern (deleted, or already renamed by the user to something else) is left alone. */
export async function renameGroupRoster(store: BotStore, members: string[], oldName: string, newName: string): Promise<void> {
  if (oldName.trim() === newName.trim()) return
  await Promise.all(
    members.map(async (id) => {
      const bot = store.bots.get(id)
      if (!bot || isGroup(bot)) return
      const role = roleOf(bot.name)
      if (!role || bot.name !== named(role, oldName)) return
      await store.save({ ...draftOf(bot), name: named(role, newName) })
    }),
  )
}

/** The name the one account-wide bot that oversees every group's JEV is created and recognized under. */
export const JEV_LEAD_NAME = 'JEV Lead'

/** JEV Lead's standing instructions: once a day, look across every group's JEV and tighten up what
 *  isn't working — it's a reviewer of other JEVs, not a group member or a task-doer itself. */
const JEV_LEAD_INSTRUCTIONS =
  'You are JEV Lead, the one account-wide bot that watches over every group’s JEV supervisor. On your daily ' +
  'routine, use list_team to find every bot whose name starts with "JEV", and for each one look at what it ' +
  'and its group have been doing since you last checked (its chat history, and its group’s): notice mistakes ' +
  'it made, plans that went wrong, or a habit worth fixing — then use update_bot to refine that JEV’s own ' +
  'instructions so it does better next time. Make small, specific corrections tied to something that actually ' +
  'happened, not generic advice. Summarize in your own chat which JEVs you touched and why. You manage the ' +
  'team only to review and correct existing JEV bots: never create a bot, never add yourself or anyone to a ' +
  'group, and leave every other kind of bot alone.'

/** The one JEV Lead for this computer: created once, the first time any group needs its own JEV, with a
 *  daily routine that reviews and corrects every group's JEV. It is never a member of any group itself,
 *  and — like every JEV — runs on Fable 5.2. */
export async function ensureJevLead(store: BotStore): Promise<string> {
  const existing = store.roster.find((b) => !isGroup(b) && b.name === JEV_LEAD_NAME)
  if (existing) return existing.id
  const draft = fillDefaults(store, newDraft())
  draft.name = JEV_LEAD_NAME
  draft.description = JEV_LEAD_INSTRUCTIONS
  draft.manageTeam = true
  draft.mode = AUTO_MODE
  draft.model = await pickModel(store, draft.backend, 'fable')
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
