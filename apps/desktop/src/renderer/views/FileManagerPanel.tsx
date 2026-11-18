import { useEffect, useState } from 'react'
import type { LibraryItem } from '@shared/artifacts'
import { Icon } from '../components/Icon'
import { VStack } from '../components/Stack'
import { Text } from '../components/Text'
import { libraryGroups } from '../lib/library-groups'
import { useModels } from '../lib/observable'
import { useTr } from '../lib/use-language'
import type { RosterItem } from '../store/app-model'
import { useApp } from '../store/context'
import { attachmentSymbol } from './thread/Attachments'
import './file-manager.css'

/** One Library item found on some bot or group, with where it came from. */
interface Found {
  at: number
  item: LibraryItem
  ref: RosterItem
}

/**
 * The account's file manager: every artifact and shared file across every group and bot, newest
 * first — the sidebar's bottom half, under the groups on top. Opening a row jumps to the chat it
 * came from (its own Library there has the rest: rename, download, share). With `members`, narrows
 * this down to just those bots' own files — a group's dashboard column embeds it this way, scoped
 * to its own roster, with the same click-to-open.
 */
export function FileManagerPanel({ onOpen, members, title }: { onOpen: (ref: RosterItem['ref']) => void; members?: string[]; title?: string }) {
  const tr = useTr()
  const app = useApp()
  useModels([...app.stores.values()])
  const roster = members ? app.roster.filter((ref) => members.includes(ref.ref.botId)) : app.roster
  const [found, setFound] = useState<Found[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all(
      roster.map(async (ref): Promise<Found[]> => {
        try {
          const items = await ref.store.artifacts.library(ref.store.client, ref.ref.botId)
          return items.map((item) => ({ at: item.at, item, ref }))
        } catch {
          return []
        }
      }),
    ).then(
      (lists) => {
        if (live) {
          setFound(lists.flat().sort((a, b) => b.at - a.at))
          setError(null)
        }
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      live = false
    }
    // Re-reads whenever the roster's shape changes (a bot or group added or removed); a chat's
    // own Library stays current the way it already does, with its own refresh.
  }, [roster.length])

  return (
    <VStack gap={8} className="file-manager">
      <Text size="caption" weight="semibold" tone="secondary" className="file-manager-title">{tr(title ?? 'Files')}</Text>
      {error ? (
        <Text size="caption2" tone="danger" role="alert" className="file-manager-empty">{error}</Text>
      ) : found.length === 0 ? (
        <Text size="caption2" tone="secondary" className="file-manager-empty">{tr('Nothing made or shared yet.')}</Text>
      ) : (
        <VStack gap={2} className="file-manager-list">
          {libraryGroups(found).map(({ group, items }) => (
            <section key={group} className="file-manager-section">
              <Text size="caption2" tone="tertiary" className="file-manager-group">{tr(group)}</Text>
              {items.map((item) => (
                <FoundRow key={rowKey(item)} found={item} onOpen={onOpen} />
              ))}
            </section>
          ))}
        </VStack>
      )}
    </VStack>
  )
}

function rowKey(found: Found) {
  return found.item.kind === 'artifact' ? found.item.artifact.id : found.item.file.id
}

function FoundRow({ found, onOpen }: { found: Found; onOpen: (ref: RosterItem['ref']) => void }) {
  const { item, ref } = found
  const name = item.kind === 'artifact' ? item.artifact.title : item.file.name
  const icon = item.kind === 'artifact' ? 'chart.bar.doc.horizontal' : attachmentSymbol(item.file.name)
  return (
    <button className="file-manager-row" onClick={() => onOpen(ref.ref)} title={`${name} · ${ref.bot.name}`}>
      <Icon name={icon} size={13} color="var(--secondary)" />
      <VStack gap={0} grow shrink>
        <Text size="caption" truncate>{name}</Text>
        <Text size="caption2" tone="tertiary" truncate>{ref.bot.name}</Text>
      </VStack>
    </button>
  )
}
