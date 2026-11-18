import { useEffect, useState } from 'react'
import type { Bot, GroupTask } from '@shared/models'
import { Button, CardSection } from '../components/Controls'
import { HStack, Spacer } from '../components/Stack'
import { Text } from '../components/Text'
import { useTr } from '../lib/use-language'
import { useStore } from '../store/context'
import { claimTask, fetchTasks } from './bots/group-tasks'
import './group-task-board.css'

/** One task's name, however it was claimed — "我" for this account, otherwise the friend's name
 *  (falling back to their id until the friend list is threaded through here too). */
function claimantLabel(task: GroupTask, tr: (s: string) => string): string {
  if (!task.claimedBy) return tr('Unclaimed')
  return task.claimedBy === 'me' ? tr('Me') : task.claimedBy
}

/**
 * 任务认领卡片 (design doc "模型与额度归属"): one card, one row per claimable work-bot task JEV has
 * posted for this group. Claiming a row grays it out — just that row, not the others — and
 * instantiates the actual bot on this account's own model quota. The group's six standing roles
 * never appear here; they're always created directly on the group owner's quota.
 */
export function GroupTaskBoard({ group }: { group: Bot }) {
  const tr = useTr()
  const store = useStore()
  const [tasks, setTasks] = useState<GroupTask[]>([])
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => setTasks(await fetchTasks(store, group.id))

  useEffect(() => {
    void refresh()
  }, [group.id])

  if (tasks.length === 0) return null

  const claim = async (task: GroupTask) => {
    setError(null)
    setClaiming(task.id)
    try {
      await claimTask(store, group.id, task, group.name)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setClaiming(null)
    }
  }

  return (
    <>
      <CardSection title="Open tasks">
        {tasks.map((task) => (
          <HStack key={task.id} gap={8} className={`task-row${task.claimedBy ? ' task-row-claimed' : ''}`}>
            <Text as="div" grow truncate tone={task.claimedBy ? 'tertiary' : 'text'}>{task.title}</Text>
            {task.claimedBy ? (
              <Text as="div" size="caption" tone="tertiary">{claimantLabel(task, tr)}</Text>
            ) : (
              <Spacer />
            )}
            {task.claimedBy ? null : (
              <Button kind="secondary" disabled={claiming === task.id} onClick={() => void claim(task)}>
                {claiming === task.id ? 'Claiming…' : 'Claim'}
              </Button>
            )}
          </HStack>
        ))}
      </CardSection>
      {error ? <Text as="div" tone="danger" size="caption" className="task-board-error">{error}</Text> : null}
    </>
  )
}
