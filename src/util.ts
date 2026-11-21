import { readFile, writeFile, type Angles, type Vector } from 'modlock'

// Game time in seconds, updated by main.ts on every frame.
let clockNow = 0
export function now(): number {
  return clockNow
}
// Called when game time jumps backwards (a new map restarts the clock), so
// timers kept in game time can start over.
const clockResets: (() => void)[] = []
export function onClockReset(fn: () => void): void {
  clockResets.push(fn)
}
export function setNow(t: number): void {
  if (t < clockNow - 1) {
    clockNow = t
    lastFlush = -10
    for (const fn of clockResets) fn()
    return
  }
  clockNow = t
}

let debugOn = false
export function setDebug(on: boolean): void {
  debugOn = on
}
export function isDebug(): boolean {
  return debugOn
}
export function log(...parts: unknown[]): void {
  console.log('[dt]', ...parts)
}
export function dbg(...parts: unknown[]): void {
  if (debugOn) console.log('[dt:debug]', ...parts)
}

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
export function randInt(min: number, maxInclusive: number): number {
  return Math.floor(rand(min, maxInclusive + 1))
}
export function pick<T>(list: readonly T[]): T | undefined {
  if (list.length === 0) return undefined
  return list[Math.floor(Math.random() * list.length)]
}
export function shuffle<T>(list: readonly T[]): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = out[i]
    out[i] = out[j]
    out[j] = t
  }
  return out
}
export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}

export function fmtVec(v: Vector): string {
  return `(${Math.round(v.x)}, ${Math.round(v.y)}, ${Math.round(v.z)})`
}
export function fmtAng(a: Angles): string {
  return `(${Math.round(a.pitch)}, ${Math.round(a.yaw)}, ${Math.round(a.roll)})`
}
export function round1(v: number): number {
  return Math.round(v * 10) / 10
}

// JSON file helpers. readFile falls back to the copy shipped in data/.
export function loadJson<T>(path: string, fallback: T): T {
  const text = readFile(path)
  if (text === undefined || text.trim() === '') return fallback
  try {
    return JSON.parse(text) as T
  } catch (e) {
    log(`could not parse ${path}:`, e)
    return fallback
  }
}
// Saves are queued and written one file per call to flushSaves(), which main
// calls every frame: a burst of saves (end of a round writes stats, progress
// and settings) would otherwise freeze the server for a moment.
const pendingSaves: Record<string, string> = {}
let lastFlush = -10

export function saveJson(path: string, value: unknown): void {
  pendingSaves[path] = JSON.stringify(value, null, 2)
}

// Writes one queued file, at most every 0.5 s; `all` writes everything now.
export function flushSaves(all = false): void {
  const paths = Object.keys(pendingSaves)
  if (paths.length === 0) return
  if (!all && clockNow - lastFlush < 0.5) return
  lastFlush = clockNow
  for (const path of all ? paths : paths.slice(0, 1)) {
    if (!writeFile(path, pendingSaves[path])) log(`could not write ${path}`)
    delete pendingSaves[path]
  }
}
