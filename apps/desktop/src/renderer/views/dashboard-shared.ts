import type { Bot } from '@shared/models'

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
