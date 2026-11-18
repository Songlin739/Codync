import { AUTO_MODE } from '@shared/approvals'
import type { GroupTask } from '@shared/models'
import type { BotStore } from '../../store/bot-store'
import { fillDefaults, named, newDraft, pickModel } from './drafts'

/** The claimable-task board for one 好友协作群 (design doc "模型与额度归属"): JEV posts an open
 *  task instead of creating a work bot directly, and whoever claims it is who the resulting
 *  bot's model quota belongs to. Claiming here always means "this account claims it" — a
 *  friend claiming it on their own computer is a fact this host can only record once the
 *  group's P2P data channel can carry it over (see `p2p-signal.ts`); until then, `fetchTasks`
 *  only ever sees tasks posted or claimed on this computer. */
export async function fetchTasks(store: BotStore, groupId: string): Promise<GroupTask[]> {
  const { items } = await (await store.ready()).call<{ items: GroupTask[] }>('groupTasks', { groupId })
  return items
}

export async function postTask(store: BotStore, groupId: string, title: string, instructions: string, createdBy: string): Promise<GroupTask> {
  const { task } = await (await store.ready()).call<{ task: GroupTask }>('groupTaskPost', { groupId, title, instructions, createdBy })
  return task
}

/**
 * Claims an open task for this account: marks it claimed, then instantiates the actual work
 * bot — named and run exactly like a task bot JEV would have created directly, but bound to
 * whoever clicked claim (which, until cross-host sync exists, is always this account) rather
 * than automatically to the group owner. Returns the new bot's id.
 */
export async function claimTask(store: BotStore, groupId: string, task: GroupTask, groupName: string): Promise<string> {
  await (await store.ready()).call('groupTaskClaim', { groupId, taskId: task.id, claimant: 'me' })

  const sample = fillDefaults(store, newDraft())
  const draft = fillDefaults(store, newDraft())
  draft.name = named(task.title, groupName)
  draft.description = task.instructions
  draft.mode = AUTO_MODE
  draft.model = await pickModel(store, sample.backend, 'opus')

  const bot = await store.save(draft)
  await (await store.ready()).call('groupTaskSetClaimedBot', { groupId, taskId: task.id, botId: bot.id })
  return bot.id
}

/** Un-claims a task that hasn't been turned into a running bot yet (the host refuses this once
 *  `claimedBotId` is set — delete the bot first if you actually want to undo a claim). */
export async function unclaimTask(store: BotStore, groupId: string, taskId: string): Promise<void> {
  await (await store.ready()).call('groupTaskUnclaim', { groupId, taskId })
}
