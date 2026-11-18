import { HStack, Spacer, VStack } from '../components/Stack'
import { Text } from '../components/Text'
import { IconButton } from '../components/Controls'
import { useApp } from '../store/context'
import { useModels } from '../lib/observable'
import { useDark } from '../lib/theme'
import { useTr } from '../lib/use-language'
import { isGroup } from '@shared/models'
import { refKey, type BotRef, type RosterItem } from '../store/app-model'
import { PALETTE, branchPath, kindOf, signal, statsCaption, statusLabel, useBotStatsAcross, worstKind, type Kind } from './dashboard-shared'
import './dashboard.css'

const MAX_BRANCHES = 5
const MAX_LEAVES = 4

/** One branch of the tree: a group and its members, or the dashed "standalone" bucket for bots in no group. */
interface Branch {
  key: string
  name: string
  dashed: boolean
  group: RosterItem | null
  children: RosterItem[]
  overflow: number
}

/** Evenly spread `count` positions between `top` and `bottom` (a single one goes in the middle). */
function spread(count: number, top: number, bottom: number): number[] {
  if (count <= 1) return [(top + bottom) / 2]
  return Array.from({ length: count }, (_, i) => top + ((bottom - top) * i) / (count - 1))
}

/** Live status board: a mind-map of the account down to every group and its bots — Codync at the
 * root, a branch per group (plus a dashed branch for bots in no group), colored by the loudest
 * status underneath it — with a real-time activity log and per-bot signal strength underneath.
 * Reuses the same observable roster the sidebar already keeps in sync; nothing here is polled.
 * `ownWindow` (the Dashboard's own window, which has no chat of its own in the same renderer process)
 * sends a node's click to the chat window instead of this process's own (otherwise unused) selection. */
export function DashboardView({ onClose, ownWindow = false }: { onClose?: () => void; ownWindow?: boolean }) {
  const tr = useTr()
  const app = useApp()
  const open = (ref: BotRef) => (ownWindow ? window.codync.app.openBotInChat(refKey(ref)) : app.select(ref))
  const dark = useDark()
  useModels([...app.stores.values()])
  const roster = app.roster

  const groupItems = roster.filter((i) => isGroup(i.bot))
  const inAGroup = new Set(groupItems.flatMap((g) => g.bot.members))
  const standalone = roster.filter((i) => !isGroup(i.bot) && !inAGroup.has(i.ref.botId))

  const allBranches: Branch[] = [
    ...groupItems.map((g) => ({
      key: g.ref.botId,
      name: g.bot.name,
      dashed: false,
      group: g,
      children: g.bot.members
        .map((id) => roster.find((r) => r.ref.botId === id && r.ref.computerId === g.ref.computerId))
        .filter((r): r is RosterItem => !!r),
      overflow: 0,
    })),
    ...(standalone.length > 0 ? [{ key: '__standalone', name: tr('Standalone'), dashed: true, group: null, children: standalone, overflow: 0 }] : []),
  ].map((b) => ({ ...b, overflow: Math.max(0, b.children.length - MAX_LEAVES), children: b.children.slice(0, MAX_LEAVES) }))
  const branches = allBranches.slice(0, MAX_BRANCHES)
  const branchOverflow = allBranches.length - branches.length
  const shown = branches.flatMap((b) => b.children)
  const totalBots = roster.length

  const width = 760
  // Just tall enough for the branches themselves — a floor sized for a full MAX_BRANCHES left a wide
  // dead band above the activity/signal cards for an account with only one or two groups.
  const height = Math.max(170, branches.length * 64)
  const rootX = 70
  const rootY = height / 2
  const branchX = 330
  const leafX = 610
  const branchYs = spread(branches.length, 50, height - 50)

  const hub = dark ? PALETTE.hub.dark : PALETTE.hub.light
  const active = [...roster].filter((i) => i.bot.status !== 'idle').sort((a, b) => signal(kindOf(b.bot)) - signal(kindOf(a.bot)))
  const log = active.slice(0, 6)
  const stats = useBotStatsAcross(shown)

  return (
    <VStack gap={10} className="dashboard-view">
      <HStack>
        <Text size="body" weight="semibold">{tr('Dashboard')}</Text>
        <Spacer />
        {onClose ? <IconButton title={tr('Close dashboard')} icon="xmark" onClick={onClose} /> : null}
      </HStack>
      {roster.length === 0 ? (
        <Text as="div" size="callout" tone="secondary" className="outlined-card dashboard-empty">
          {tr('No bots to show yet.')}
        </Text>
      ) : (
        <>
          <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" className="dashboard-graph dashboard-graph-tree">
            <title>{tr('Codync agent tree')}</title>
            <desc>{tr('Codync at the root, branching to every group and bot, colored by live status.')}</desc>
            {branches.map((branch, bi) => {
              const by = branchYs[bi]!
              const kind: Kind = branch.group ? worstKind(branch.children.map((c) => kindOf(c.bot))) : 'idle'
              const p = PALETTE[kind][dark ? 'dark' : 'light']
              const leafYs = spread(branch.children.length, by - 18 - branch.children.length * 10, by + 18 + branch.children.length * 10)
              return (
                <g key={branch.key}>
                  <path d={branchPath(rootX, rootY, branchX, by)} fill="none" stroke={p.glow} strokeWidth={6} opacity={0.22} />
                  <path
                    d={branchPath(rootX, rootY, branchX, by)}
                    fill="none"
                    stroke={p.stroke}
                    strokeWidth={2}
                    strokeDasharray={branch.dashed ? '5 4' : undefined}
                  />
                  {branch.children.map((child, ci) => {
                    const cp = PALETTE[kindOf(child.bot)][dark ? 'dark' : 'light']
                    const ly = leafYs[ci]!
                    return (
                      <g key={`leaf-line-${child.ref.botId}`}>
                        <path d={branchPath(branchX, by, leafX, ly)} fill="none" stroke={cp.glow} strokeWidth={5} opacity={0.2} />
                        <path d={branchPath(branchX, by, leafX, ly)} fill="none" stroke={cp.stroke} strokeWidth={1.5} />
                      </g>
                    )
                  })}
                </g>
              )
            })}
            <circle cx={rootX} cy={rootY} r={48} fill={hub.glow} opacity={0.22} />
            <circle cx={rootX} cy={rootY} r={34} fill={hub.fill} stroke={hub.stroke} strokeWidth={1.5} />
            <text x={rootX} y={rootY - 2} textAnchor="middle" fontSize={13} fontWeight={500} fill={hub.text}>Codync</text>
            <text x={rootX} y={rootY + 13} textAnchor="middle" fontSize={10} fill={hub.sub}>{tr('{n} bots').replaceAll('{n}', String(totalBots))}</text>
            {branches.map((branch, bi) => {
              const by = branchYs[bi]!
              const kind: Kind = branch.group ? worstKind(branch.children.map((c) => kindOf(c.bot))) : 'idle'
              const p = PALETTE[kind][dark ? 'dark' : 'light']
              const leafYs = spread(branch.children.length, by - 18 - branch.children.length * 10, by + 18 + branch.children.length * 10)
              return (
                <g key={`nodes-${branch.key}`}>
                  <g
                    className={`dashboard-node${kind === 'error' ? ' dashboard-node-error' : ''}`}
                    onClick={() => {
                      if (branch.group) open(branch.group.ref)
                      onClose?.()
                    }}
                    style={{ cursor: branch.group ? 'pointer' : 'default' }}
                  >
                    <circle cx={branchX} cy={by} r={34} fill={p.glow} opacity={0.18} />
                    <circle
                      cx={branchX}
                      cy={by}
                      r={24}
                      fill={p.fill}
                      stroke={p.stroke}
                      strokeWidth={2}
                      strokeDasharray={branch.dashed ? '4 3' : undefined}
                    />
                    <text x={branchX} y={by + 4} textAnchor="middle" fontSize={11} fontWeight={500} fill={p.text}>
                      {branch.name.length > 11 ? `${branch.name.slice(0, 10)}…` : branch.name}
                    </text>
                  </g>
                  {branch.overflow > 0 ? (
                    <text x={branchX} y={by + 38} textAnchor="middle" fontSize={9} fill={p.sub}>
                      {tr('+{n} more').replaceAll('{n}', String(branch.overflow))}
                    </text>
                  ) : null}
                  {branch.children.map((child, ci) => {
                    const cp = PALETTE[kindOf(child.bot)][dark ? 'dark' : 'light']
                    const ly = leafYs[ci]!
                    return (
                      <g
                        key={child.ref.botId}
                        className={`dashboard-node${kindOf(child.bot) === 'error' ? ' dashboard-node-error' : ''}`}
                        onClick={() => {
                          open(child.ref)
                          onClose?.()
                        }}
                      >
                        <circle cx={leafX} cy={ly} r={30} fill={cp.glow} opacity={0.2} />
                        <circle cx={leafX} cy={ly} r={20} fill={cp.fill} stroke={cp.stroke} strokeWidth={2} />
                        <text x={leafX} y={ly - 3} textAnchor="middle" fontSize={11} fontWeight={500} fill={cp.text}>
                          {child.bot.name.length > 9 ? `${child.bot.name.slice(0, 8)}…` : child.bot.name}
                        </text>
                        <text x={leafX} y={ly + 11} textAnchor="middle" fontSize={9} fill={cp.sub}>
                          {statusLabel(child.bot.status, tr)}
                        </text>
                      </g>
                    )
                  })}
                </g>
              )
            })}
          </svg>
          {branchOverflow > 0 ? (
            <Text size="caption" tone="secondary" className="dashboard-overflow">
              {tr('+{n} more groups not shown').replaceAll('{n}', String(branchOverflow))}
            </Text>
          ) : null}
          <HStack gap={10} align="flex-start" className="dashboard-panels">
            <VStack gap={6} className="dashboard-panel dashboard-log" grow>
              <Text size="caption" tone="secondary" className="dashboard-panel-heading">{tr('Live activity')}</Text>
              {log.length === 0 ? (
                <Text size="callout" tone="secondary">{tr('All quiet right now.')}</Text>
              ) : (
                <VStack gap={4}>
                  {log.map((item) => (
                    <Text key={item.ref.botId} size="callout" tone={item.bot.status === 'error' ? 'danger' : item.bot.status === 'needsInput' ? 'attention' : 'text'} lines={1}>
                      {item.bot.name}{' '}{item.bot.activity || statusLabel(item.bot.status, tr)}
                    </Text>
                  ))}
                </VStack>
              )}
            </VStack>
            <VStack gap={6} className="dashboard-panel dashboard-signals">
              <Text size="caption" tone="secondary" className="dashboard-panel-heading">{tr('Signal strength')}</Text>
              {shown.map((item) => {
                const kind = kindOf(item.bot)
                const caption = statsCaption(stats[item.ref.botId])
                return (
                  <VStack key={item.ref.botId} gap={2}>
                    <HStack gap={6}>
                      <Text size="caption" tone={kind === 'error' ? 'danger' : kind === 'needsInput' ? 'attention' : 'secondary'} lines={1} grow>{item.bot.name}</Text>
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
        </>
      )}
    </VStack>
  )
}
