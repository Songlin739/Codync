import { useEffect, useState } from 'react'
import type { Bot } from '@shared/models'
import type { BotStore } from '../store/bot-store'

/** A status's colors (node fill/stroke/text, glow tint, bar fill), light and dark. Shared between the
 * account-wide Dashboard and a single group's own Dashboard, so both read as one visual system. */
export const PALETTE = {
  working: {
    light: { fill: '#E1F5EE', stroke: '#1D9E75', text: '#04342C', sub: '#085041', glow: '#5DCAA5' },
    dark: { fill: '#04342C', stroke: '#5DCAA5', text: '#E1F5EE', sub: '#9FE1CB', glow: '#1D9E75' },
  },
  needsInput: {
    light: { fill: '#FAEEDA', stroke: '#EF9F27', text: '#412402', sub: '#633806', glow: '#FAC775' },
    dark: { fill: '#412402', stroke: '#FAC775', text: '#FAEEDA', sub: '#FAC775', glow: '#BA7517' },
  },
  error: {
    light: { fill: '#FCEBEB', stroke: '#E24B4A', text: '#501313', sub: '#791F1F', glow: '#F09595' },
    dark: { fill: '#501313', stroke: '#F09595', text: '#FCEBEB', sub: '#F7C1C1', glow: '#A32D2D' },
  },
  idle: {
    light: { fill: '#F1EFE8', stroke: '#B4B2A9', text: '#2C2C2A', sub: '#5F5E5A', glow: '#D3D1C7' },
    dark: { fill: '#2C2C2A', stroke: '#888780', text: '#F1EFE8', sub: '#D3D1C7', glow: '#5F5E5A' },
  },
  hub: {
    light: { fill: '#EEEDFE', stroke: '#534AB7', text: '#26215C', sub: '#3C3489', glow: '#AFA9EC' },
    dark: { fill: '#26215C', stroke: '#AFA9EC', text: '#EEEDFE', sub: '#CECBF6', glow: '#7F77DD' },
  },
} as const

export type Kind = keyof typeof PALETTE

export const kindOf = (bot: Pick<Bot, 'status'>): Kind =>
  bot.status === 'working' ? 'working' : bot.status === 'needsInput' ? 'needsInput' : bot.status === 'error' ? 'error' : 'idle'

/** Roughly how "loud" a bot's signal is right now: errors and open questions read as loudest (they
 * want you), working is active but steady, idle is quiet. */
export const signal = (kind: Kind) => (kind === 'error' ? 1 : kind === 'needsInput' ? 0.8 : kind === 'working' ? 0.55 : 0.08)

export function statusLabel(status: string, tr: (s: string) => string) {
  if (status === 'working') return tr('Working…')
  if (status === 'needsInput') return tr('Needs you')
  if (status === 'error') return tr('Error')
  return tr('Idle')
}

/** A branch's own color: the loudest status among its members (error beats needsInput beats
 * working beats idle), so a group or account node reads as "needs attention" the moment anything under it does. */
export function worstKind(kinds: Kind[]): Kind {
  if (kinds.includes('error')) return 'error'
  if (kinds.includes('needsInput')) return 'needsInput'
  if (kinds.includes('working')) return 'working'
  return 'idle'
}

/** A quadratic bezier from (x1,y1) to (x2,y2), bowing right — the "mind map" branch curve used at
 * every level of the tree dashboards. */
export const branchPath = (x1: number, y1: number, x2: number, y2: number) => {
  const midX = x1 + (x2 - x1) * 0.55
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
}

/** The host's `chat::stats` counters for one bot — coarse and best-effort (host `botStats`). */
export interface BotStats {
  turns: number
  inputTokens: number
  cachedReadTokens: number
  cachedWriteTokens: number
  totalLatencyMs: number
}

/** `turns`-weighted average latency, 0 with no turns yet — the same guard the host's own `avg_latency_ms` applies. */
export const avgLatencyMs = (s: BotStats) => (s.turns > 0 ? Math.round(s.totalLatencyMs / s.turns) : 0)

/** A short "12.4k tok · 2.1s" reading for a bot's signal-strength row; null while there's nothing to show yet
 *  (no turns at all) rather than a confusing "0 tok · 0s". */
export function statsCaption(s: BotStats | undefined): string | null {
  if (!s || s.turns === 0) return null
  const tokens = s.inputTokens + s.cachedReadTokens + s.cachedWriteTokens
  const tok = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tok` : `${tokens} tok`
  const ms = avgLatencyMs(s)
  const latency = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
  return `${tok} · ${latency}`
}

/** Every member's token/latency counters from this computer's host, refreshed periodically — "for my
 *  monitoring" (the user's own words): best-effort and never blocks the rest of the dashboard on failure. */
export function useBotStats(store: BotStore, botIds: string[]): Record<string, BotStats> {
  const [stats, setStats] = useState<Record<string, BotStats>>({})
  const key = botIds.join(',')
  useEffect(() => {
    if (!key) return
    let live = true
    const refresh = () => {
      const client = store.client
      if (!client) return
      void client
        .call<{ stats: Record<string, BotStats> }>('botStats', { botIds: key.split(',') })
        .then((res) => {
          if (live) setStats(res.stats)
        })
        .catch(() => {
          // Best-effort: the rest of the dashboard carries on without it.
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 20_000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [store, key])
  return stats
}

/** The same counters as `useBotStats`, but for a roster that spans several computers (the account-wide
 *  Dashboard): one `botStats` call per computer, merged into one lookup by bot id. */
export function useBotStatsAcross(items: { ref: { botId: string; computerId: string }; store: BotStore }[]): Record<string, BotStats> {
  const [stats, setStats] = useState<Record<string, BotStats>>({})
  const byStore = new Map<BotStore, string[]>()
  for (const item of items) byStore.set(item.store, [...(byStore.get(item.store) ?? []), item.ref.botId])
  const key = items.map((i) => `${i.ref.computerId}:${i.ref.botId}`).join('|')
  useEffect(() => {
    if (!key) return
    let live = true
    const refresh = () => {
      void Promise.all(
        [...byStore.entries()].map(async ([store, botIds]) => {
          const client = store.client
          if (!client) return {}
          try {
            const res = await client.call<{ stats: Record<string, BotStats> }>('botStats', { botIds })
            return res.stats
          } catch {
            return {}
          }
        }),
      ).then((parts) => {
        if (live) setStats(Object.assign({}, ...parts))
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 20_000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [key])
  return stats
}
