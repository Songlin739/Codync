import { HStack, Spacer, VStack } from '../components/Stack'
import { Text } from '../components/Text'
import { IconButton } from '../components/Controls'
import { useApp, useStore } from '../store/context'
import { useModels } from '../lib/observable'
import { useDark } from '../lib/theme'
import { useTr } from '../lib/use-language'
import type { Bot } from '@shared/models'
import { FileManagerPanel } from './FileManagerPanel'
import { GroupTaskBoard } from './GroupTaskBoard'
import { PALETTE, branchPath, kindOf, signal, statsCaption, statusLabel, useBotStats, worstKind } from './dashboard-shared'
import './dashboard.css'

const MAX_LEAVES = 6

/** Evenly spread `count` positions between `top` and `bottom` (a single one goes in the middle). */
function spread(count: number, top: number, bottom: number): number[] {
  if (count <= 1) return [(top + bottom) / 2]
  return Array.from({ length: count }, (_, i) => top + ((bottom - top) * i) / (count - 1))
}

/** One group's own status board: the same mind-map style as the account-wide Dashboard, but with
 * just this group at the root and its members as the one level of leaves underneath. Lives as a
 * persistent third column beside a group's chat; `onClose`, when given, draws a close button (the
 * standalone, dismissible presentation an older version used). */
export function GroupDashboardView({ group, onClose, onSelectMember }: { group: Bot; onClose?: () => void; onSelectMember: (id: string) => void }) {
  const tr = useTr()
  const store = useStore()
  const app = useApp()
  const dark = useDark()
  useModels([store])
  const allMembers = store.members(group)
  const overflow = Math.max(0, allMembers.length - MAX_LEAVES)
  const members = allMembers.slice(0, MAX_LEAVES)
  const stats = useBotStats(store, allMembers.map((m) => m.id))

  const width = 620
  // Just tall enough for the leaves themselves — a floor that assumed room for a full MAX_LEAVES
  // left a wide dead band above the activity/signal cards for a group with only one or two bots.
  const height = Math.max(150, members.length * 46)
  const rootX = 64
  const rootY = height / 2
  const leafX = 440
  const leafYs = spread(members.length, 40, height - 40)

  const hub = PALETTE.hub[dark ? 'dark' : 'light']
  const overall = PALETTE[worstKind(members.map(kindOf))][dark ? 'dark' : 'light']
  const active = [...members].filter((b) => b.status !== 'idle').sort((a, b) => signal(kindOf(b)) - signal(kindOf(a)))
  const log = active.slice(0, 6)

  return (
    <VStack gap={10} className="dashboard-view dashboard-view-column">
      <HStack>
        <Text size="body" weight="semibold">{group.name}</Text>
        <Spacer />
        {onClose ? <IconButton title={tr('Close dashboard')} icon="xmark" onClick={onClose} /> : null}
      </HStack>
      <VStack gap={10} className="dashboard-upper">
      {members.length === 0 ? (
        <Text as="div" size="callout" tone="secondary" className="outlined-card dashboard-empty">
          {tr('No bots in this group yet.')}
        </Text>
      ) : (
        <>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" className="dashboard-graph dashboard-graph-tree">
            <title>{tr('{name} agent tree').replaceAll('{name}', group.name)}</title>
            <desc>{tr('This group at the root, branching to each of its bots, colored by live status.')}</desc>
            {members.map((member, i) => {
              const p = PALETTE[kindOf(member)][dark ? 'dark' : 'light']
              const ly = leafYs[i]!
              return (
                <g key={`line-${member.id}`}>
                  <path d={branchPath(rootX, rootY, leafX, ly)} fill="none" stroke={p.glow} strokeWidth={6} opacity={0.22} />
                  <path d={branchPath(rootX, rootY, leafX, ly)} fill="none" stroke={p.stroke} strokeWidth={2} />
                </g>
              )
            })}
            <circle cx={rootX} cy={rootY} r={42} fill={overall.glow} opacity={0.22} />
            <circle cx={rootX} cy={rootY} r={30} fill={hub.fill} stroke={hub.stroke} strokeWidth={1.5} />
            <text x={rootX} y={rootY - 2} textAnchor="middle" fontSize={11} fontWeight={500} fill={hub.text}>
              {group.name.length > 9 ? `${group.name.slice(0, 8)}…` : group.name}
            </text>
            <text x={rootX} y={rootY + 12} textAnchor="middle" fontSize={9} fill={hub.sub}>{tr('{n} bots').replaceAll('{n}', String(allMembers.length))}</text>
            {members.map((member, i) => {
              const p = PALETTE[kindOf(member)][dark ? 'dark' : 'light']
              const ly = leafYs[i]!
              return (
                <g key={member.id} className={`dashboard-node${kindOf(member) === 'error' ? ' dashboard-node-error' : ''}`} onClick={() => { onSelectMember(member.id); onClose?.() }}>
                  <circle cx={leafX} cy={ly} r={34} fill={p.glow} opacity={0.2} />
                  <circle cx={leafX} cy={ly} r={23} fill={p.fill} stroke={p.stroke} strokeWidth={2} />
                  <text x={leafX} y={ly - 3} textAnchor="middle" fontSize={11} fontWeight={500} fill={p.text}>
                    {member.name.length > 10 ? `${member.name.slice(0, 9)}…` : member.name}
                  </text>
                  <text x={leafX} y={ly + 12} textAnchor="middle" fontSize={10} fill={p.sub}>
                    {statusLabel(member.status, tr)}
                  </text>
                </g>
              )
            })}
          </svg>
          {overflow > 0 ? (
            <Text size="caption" tone="secondary" className="dashboard-overflow">
              {tr('+{n} more bots not shown').replaceAll('{n}', String(overflow))}
            </Text>
          ) : null}
          <HStack gap={10} align="flex-start" className="dashboard-panels">
            <VStack gap={6} className="dashboard-panel dashboard-log" grow>
              <Text size="caption" tone="secondary" className="dashboard-panel-heading">{tr('Live activity')}</Text>
              {log.length === 0 ? (
                <Text size="callout" tone="secondary">{tr('All quiet right now.')}</Text>
              ) : (
                <VStack gap={4}>
                  {log.map((member) => (
                    <Text key={member.id} size="callout" tone={member.status === 'error' ? 'danger' : member.status === 'needsInput' ? 'attention' : 'text'} lines={1}>
                      {member.name}{' '}{member.activity || statusLabel(member.status, tr)}
                    </Text>
                  ))}
                </VStack>
              )}
            </VStack>
            <VStack gap={6} className="dashboard-panel dashboard-signals">
              <Text size="caption" tone="secondary" className="dashboard-panel-heading">{tr('Signal strength')}</Text>
              {members.map((member) => {
                const kind = kindOf(member)
                const caption = statsCaption(stats[member.id])
                return (
                  <VStack key={member.id} gap={2}>
                    <HStack gap={6}>
                      <Text size="caption" tone={kind === 'error' ? 'danger' : kind === 'needsInput' ? 'attention' : 'secondary'} lines={1} grow>{member.name}</Text>
                      {caption ? <Text size="caption2" tone="tertiary">{caption}</Text> : null}
                    </HStack>
                    <div className="dashboard-bar-track">
                      <div className={`dashboard-bar-fill dashboard-bar-${kind}`} style={{ width: `${Math.round(signal(kind) * 100)}%` }} />
                    </div>
                  </VStack>
                )
              })}
            </VStack>
          </HStack>
          <GroupTaskBoard group={group} />
        </>
      )}
      </VStack>
      <div className="dashboard-files">
        <FileManagerPanel members={group.members} title={tr('Group files')} onOpen={(ref) => app.select(ref)} />
      </div>
    </VStack>
  )
}
