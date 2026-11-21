import { loadJson, saveJson } from './util'

// Endless mode: waves of enemies at a fight spot. Kidnap every one of them
// before the wave clock runs out; each wave brings more enemies, less time
// and, every few waves, smarter bots. One life: time out or die and the run
// ends. Pure logic here; round.ts drives it.

export const MAX_ENEMIES = 6

export function waveEnemies(wave: number): number {
  return Math.min(MAX_ENEMIES, 1 + Math.floor((wave - 1) / 2))
}

// Seconds for the wave: about 12 s per enemy plus a base, shrinking 1.5 s a
// wave, never under 15 s.
export function waveSeconds(wave: number): number {
  return Math.max(15, Math.round(25 + 12 * waveEnemies(wave) - 1.5 * (wave - 1)))
}

// Bots get one step smarter every 6 waves, up to Hard.
export function waveDifficulty(base: number, wave: number): number {
  return Math.min(3, base + Math.floor((wave - 1) / 6))
}

export const KIDNAP_POINTS = 100
export const MULTI_WINDOW = 1.5 // seconds: kidnaps this close together form a multi-kidnap

export function kidnapPoints(wave: number, multi: number): number {
  // Later waves are worth more; the 2nd, 3rd... kidnap of one cart double.
  return Math.round(KIDNAP_POINTS * (1 + 0.1 * (wave - 1)) * (multi > 1 ? 2 : 1))
}

export function clearBonus(wave: number, secondsLeft: number): number {
  return 200 * wave + 10 * Math.max(0, Math.floor(secondsLeft))
}

export interface Run {
  difficulty: number // the base the player picked, 1-4
  wave: number
  score: number
  kidnaps: number
  out: Record<number, boolean> // bot slots kidnapped this wave
  lastKidnapAt: number
  multi: number
  waveStart: number
}

let run: Run | undefined

export function currentRun(): Run | undefined {
  return run
}

export function startRun(difficulty: number): Run {
  run = { difficulty, wave: 1, score: 0, kidnaps: 0, out: {}, lastKidnapAt: -100, multi: 0, waveStart: 0 }
  return run
}

export function endRun(): void {
  run = undefined
}

export function beginWave(r: Run, now: number): void {
  r.out = {}
  r.multi = 0
  r.lastKidnapAt = -100
  r.waveStart = now
}

// Scores a kidnap and returns the points and the multi count (1 = single).
export function scoreKidnap(r: Run, slot: number, now: number): { points: number; multi: number } {
  r.out[slot] = true
  r.kidnaps++
  r.multi = now - r.lastKidnapAt <= MULTI_WINDOW ? r.multi + 1 : 1
  r.lastKidnapAt = now
  const points = kidnapPoints(r.wave, r.multi)
  r.score += points
  return { points, multi: r.multi }
}

export function outCount(r: Run): number {
  return Object.keys(r.out).length
}

// Clears the wave: adds the bonus, advances, returns the bonus.
export function clearWave(r: Run, secondsLeft: number): number {
  const bonus = clearBonus(r.wave, secondsLeft)
  r.score += bonus
  r.wave++
  return bonus
}

// ---- best scores, per base difficulty ----

export interface Best {
  score: number
  wave: number // the wave the run ended on
  kidnaps: number
}

interface EndlessFile {
  best: Record<string, Best>
}

const FILE = 'endless.json'
const saved: EndlessFile = loadJson<EndlessFile>(FILE, { best: {} })
if (!saved.best) saved.best = {}

export function bestFor(difficulty: number): Best | undefined {
  return saved.best[String(difficulty)]
}

// Records a finished run; returns true when it's a new best.
export function recordRun(r: Run): boolean {
  const key = String(r.difficulty)
  const prev = saved.best[key]
  if (prev && prev.score >= r.score) return false
  saved.best[key] = { score: r.score, wave: r.wave, kidnaps: r.kidnaps }
  saveJson(FILE, saved)
  return true
}

export function resetBests(): void {
  saved.best = {}
  saveJson(FILE, saved)
}
