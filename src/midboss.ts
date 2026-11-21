import { loadJson, saveJson } from './util'

// Mid-Boss fight: enemies in the pit are taking the Mid-Boss; its health
// drains faster the more of them stand in the pit. Kidnap them out through
// your doors (your team, waiting at door 1, finishes them; they respawn and
// come back) and keep the Mid-Boss alive until the clock runs out.
// The real Mid-Boss stands in the pit (src/boss.ts); its health is the bar.
// When the game refuses to spawn it, the bar is simulated here.
// Pure logic; round.ts drives it.

// Health drained per second by each enemy in the pit, by difficulty 1-3:
// 4 Medium enemies take a full Mid-Boss in about 25 s if left alone.
export const DRAIN = [0, 0.8, 1.0, 1.3]
export const PIT_RADIUS = 900 // around the pit floor's centre
export const PIT_HEIGHT = 300 // above or below the pit floor

export interface Fight {
  hp: number // 0-100
  kidnaps: number
  out: Record<number, number> // bot slot -> time it comes back
  last: number
}

let fight: Fight | undefined

export function currentFight(): Fight | undefined {
  return fight
}

export function startFight(now: number): Fight {
  fight = { hp: 100, kidnaps: 0, out: {}, last: now }
  return fight
}

export function endFight(): void {
  fight = undefined
}

// Advances the drain by the time since the last tick; returns the health
// (in %) drained this tick.
export function drain(f: Fight, now: number, inPit: number, difficulty: number): number {
  const dt = Math.max(0, Math.min(0.25, now - f.last))
  f.last = now
  const delta = DRAIN[Math.max(1, Math.min(3, difficulty))] * inPit * dt
  f.hp = Math.max(0, f.hp - delta)
  return delta
}

export function kidnapped(f: Fight, slot: number, now: number, respawn: number): void {
  f.kidnaps++
  f.out[slot] = now + respawn
}

export function score(f: Fight, won: boolean): number {
  return f.kidnaps * 100 + Math.round(f.hp) * 10 + (won ? 500 : 0)
}

// ---- best scores, per difficulty ----

export interface Best {
  score: number
  kidnaps: number
  hp: number
  won: boolean
}

interface MidbossFile {
  best: Record<string, Best>
}

const FILE = 'midboss.json'
const saved: MidbossFile = loadJson<MidbossFile>(FILE, { best: {} })
if (!saved.best) saved.best = {}

export function bestFor(difficulty: number): Best | undefined {
  return saved.best[String(difficulty)]
}

// Records a finished fight; returns true when it's a new best.
export function recordFight(f: Fight, won: boolean, difficulty: number): boolean {
  const s = score(f, won)
  const key = String(difficulty)
  const prev = saved.best[key]
  if (prev && prev.score >= s) return false
  saved.best[key] = { score: s, kidnaps: f.kidnaps, hp: Math.round(f.hp), won }
  saveJson(FILE, saved)
  return true
}

export function resetBests(): void {
  saved.best = {}
  saveJson(FILE, saved)
}
