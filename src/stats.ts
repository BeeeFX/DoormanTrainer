import { isSuccess, type Outcome } from './tracker'
import { loadJson, saveJson } from './util'

export interface Rate {
  attempts: number
  kidnaps: number
}

export interface Stats {
  attempts: number
  kidnaps: number
  kills: number
  streak: number
  bestStreak: number
  misses: Record<string, number>
  byLocation: Record<string, Rate>
  bySpot: Record<string, Rate>
  // Average seconds from the fight start to door 2 and to the cart, over kidnaps.
  door2Time: number
  cartTime: number
  timedKidnaps: number
}

const FILE = 'stats.json'

function empty(): Stats {
  return { attempts: 0, kidnaps: 0, kills: 0, streak: 0, bestStreak: 0, misses: {}, byLocation: {}, bySpot: {}, door2Time: 0, cartTime: 0, timedKidnaps: 0 }
}

export const stats: Stats = Object.assign(empty(), loadJson<Partial<Stats>>(FILE, {}))

function bump(map: Record<string, Rate>, key: string, ok: boolean): void {
  const r = map[key] ?? { attempts: 0, kidnaps: 0 }
  r.attempts++
  if (ok) r.kidnaps++
  map[key] = r
}

export function recordRound(o: Outcome, locationKey: string, spotKey: string, door2After: number, cartAfter: number): void {
  if (o === 'skipped') return
  const ok = isSuccess(o)
  stats.attempts++
  if (ok) {
    stats.kidnaps++
    stats.streak++
    if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak
    if (door2After >= 0 && cartAfter >= 0) {
      const n = stats.timedKidnaps
      stats.door2Time = (stats.door2Time * n + door2After) / (n + 1)
      stats.cartTime = (stats.cartTime * n + cartAfter) / (n + 1)
      stats.timedKidnaps = n + 1
    }
  } else {
    stats.streak = 0
    stats.misses[o] = (stats.misses[o] ?? 0) + 1
  }
  if (o === 'kidnapKill') stats.kills++
  bump(stats.byLocation, locationKey, ok)
  bump(stats.bySpot, spotKey, ok)
  saveJson(FILE, stats)
}

export function resetStats(): void {
  const e = empty()
  for (const k of Object.keys(e) as (keyof Stats)[]) (stats as unknown as Record<string, unknown>)[k] = e[k]
  saveJson(FILE, stats)
}

export function rateText(r: Rate | undefined): string {
  if (!r || r.attempts === 0) return 'new'
  return `${r.kidnaps}/${r.attempts}`
}
