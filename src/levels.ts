import { DIFFICULTY_TITLES, settings, type Behaviour, type CooldownMode, type SpotFilter } from './config'
import { currentRun, waveDifficulty, waveEnemies } from './endless'
import { loadJson, saveJson } from './util'
import { NO_MOVES, type Moves } from './walker'

export interface Level {
  n: number
  name: string
  blurb: string
  enemies: number
  allies: number
  behaviour: Behaviour
  moves: Moves // with 'walk': jumps, slides, dashes mixed into the strafing
  difficulty: number
  spotFilter: SpotFilter
  fastCooldowns: boolean
  // Pass rule: `need` kidnaps within the last `window` attempts, with at least
  // `kills` kidnap kills among them. window 0 = endless (no pass, best streak).
  need: number
  window: number
  kills: number
}

const M0: Moves = NO_MOVES
export const LEVELS: readonly Level[] = [
  { n: 1, name: 'Stationary', blurb: '1 enemy standing still, close spots', enemies: 1, allies: 0, behaviour: 'still', moves: M0, difficulty: 1, spotFilter: 'close', fastCooldowns: true, need: 5, window: 5, kills: 0 },
  { n: 2, name: 'Walking', blurb: '1 enemy strafing around, never shoots', enemies: 1, allies: 0, behaviour: 'walk', moves: M0, difficulty: 1, spotFilter: 'close', fastCooldowns: true, need: 5, window: 8, kills: 0 },
  { n: 3, name: 'Sliding', blurb: '1 enemy strafing and sliding', enemies: 1, allies: 0, behaviour: 'walk', moves: { jump: false, slide: true, dash: false }, difficulty: 1, spotFilter: 'close', fastCooldowns: true, need: 5, window: 8, kills: 0 },
  { n: 4, name: 'Jumping', blurb: '1 enemy strafing and jumping', enemies: 1, allies: 0, behaviour: 'walk', moves: { jump: true, slide: false, dash: false }, difficulty: 1, spotFilter: 'any', fastCooldowns: true, need: 5, window: 8, kills: 0 },
  { n: 5, name: 'Agile', blurb: '1 enemy dashing, sliding and jumping', enemies: 1, allies: 0, behaviour: 'walk', moves: { jump: true, slide: true, dash: true }, difficulty: 1, spotFilter: 'any', fastCooldowns: false, need: 5, window: 8, kills: 0 },
  { n: 6, name: 'Duel', blurb: '1 easy enemy fighting back', enemies: 1, allies: 0, behaviour: 'fight', moves: M0, difficulty: 1, spotFilter: 'any', fastCooldowns: false, need: 5, window: 8, kills: 0 },
  { n: 7, name: 'Skirmish', blurb: '3 medium enemies', enemies: 3, allies: 0, behaviour: 'fight', moves: M0, difficulty: 2, spotFilter: 'any', fastCooldowns: false, need: 5, window: 8, kills: 0 },
  { n: 8, name: 'Teamfight', blurb: '5 medium enemies, 2 allies', enemies: 5, allies: 2, behaviour: 'fight', moves: M0, difficulty: 2, spotFilter: 'any', fastCooldowns: false, need: 5, window: 8, kills: 0 },
  { n: 9, name: 'Full fight', blurb: '6 hard enemies, 2 allies', enemies: 6, allies: 2, behaviour: 'fight', moves: M0, difficulty: 3, spotFilter: 'any', fastCooldowns: false, need: 5, window: 8, kills: 0 },
  { n: 10, name: 'Gauntlet', blurb: '6 hard enemies, no allies, far spots', enemies: 6, allies: 0, behaviour: 'fight', moves: M0, difficulty: 3, spotFilter: 'far', fastCooldowns: false, need: 0, window: 0, kills: 0 },
]

// What a round actually uses: the ladder level's values, or the custom settings.
export interface Effective {
  label: string
  enemies: number
  allies: number
  behaviour: Behaviour
  moves: Moves
  difficulty: number
  spotFilter: SpotFilter
  cooldowns: CooldownMode
  shortVortex: boolean
  shortCart: boolean
}

// None wins; a ladder level with practice cooldowns is at least Short.
export function cooldownsFor(levelShort: boolean): CooldownMode {
  if (settings.cooldowns === 'none') return 'none'
  return levelShort || settings.cooldowns === 'short' ? 'short' : 'real'
}

export function effective(): Effective {
  if (settings.mode === 'midboss') {
    const m = settings.midboss
    return {
      label: `Mid-Boss · ${DIFFICULTY_TITLES[m.difficulty - 1]}`,
      enemies: m.enemies,
      allies: m.allies,
      behaviour: 'fight',
      moves: NO_MOVES,
      difficulty: m.difficulty,
      spotFilter: 'any',
      cooldowns: cooldownsFor(false),
      shortVortex: settings.shortVortex.midboss,
      shortCart: settings.shortCart.midboss,
    }
  }
  if (settings.mode === 'endless') {
    const r = currentRun()
    const wave = r ? r.wave : 1
    const base = r ? r.difficulty : settings.endlessDifficulty
    return {
      label: `Endless · ${DIFFICULTY_TITLES[base - 1]}`,
      enemies: waveEnemies(wave),
      allies: 0,
      behaviour: 'fight',
      moves: NO_MOVES,
      difficulty: waveDifficulty(base, wave),
      spotFilter: 'any',
      cooldowns: cooldownsFor(false),
      shortVortex: settings.shortVortex.endless,
      shortCart: settings.shortCart.endless,
    }
  }
  if (settings.mode === 'ladder') {
    const l = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, settings.level - 1))]
    return {
      label: `Level ${l.n} · ${l.name}`,
      enemies: l.enemies,
      allies: l.allies,
      behaviour: l.behaviour,
      moves: l.moves,
      difficulty: l.difficulty,
      spotFilter: l.spotFilter,
      cooldowns: cooldownsFor(l.fastCooldowns),
      shortVortex: settings.shortVortex.ladder,
      shortCart: settings.shortCart.ladder,
    }
  }
  return {
    label: 'Practice',
    enemies: settings.enemies,
    allies: settings.allies,
    behaviour: settings.behaviour,
    moves: settings.moves,
    difficulty: settings.difficulty,
    spotFilter: settings.spotFilter,
    cooldowns: cooldownsFor(false),
    shortVortex: settings.shortVortex.custom,
    shortCart: settings.shortCart.custom,
  }
}

// ---- progress ----

export interface LevelProgress {
  recent: string[] // 'k' kidnap, 'K' kidnap kill, '-' miss; newest last
  passed: boolean
  attempts: number
  kidnaps: number
  streak: number // current run of kidnaps on this level
  bestStreak: number
}

interface Progress {
  unlocked: number // highest unlocked level
  levels: Record<string, LevelProgress>
}

const FILE = 'progress.json'
const progress: Progress = loadJson<Progress>(FILE, { unlocked: 1, levels: {} })
if (!(progress.unlocked >= 1)) progress.unlocked = 1
if (!progress.levels) progress.levels = {}

export function levelProgress(n: number): LevelProgress {
  const key = String(n)
  let p = progress.levels[key]
  if (!p) {
    p = { recent: [], passed: false, attempts: 0, kidnaps: 0, streak: 0, bestStreak: 0 }
    progress.levels[key] = p
  }
  if (typeof p.streak !== 'number') p.streak = 0
  return p
}

export function unlockedLevel(): number {
  return progress.unlocked
}

export function isUnlocked(n: number): boolean {
  return n <= progress.unlocked
}

// Records one counted attempt; returns the newly unlocked level number, if any.
export function recordLevelResult(n: number, kidnap: boolean, kill: boolean): number | undefined {
  const l = LEVELS[n - 1]
  if (!l) return undefined
  const p = levelProgress(n)
  p.attempts++
  if (kidnap) {
    p.kidnaps++
    p.streak++
  } else p.streak = 0
  if (p.streak > p.bestStreak) p.bestStreak = p.streak
  p.recent.push(kill ? 'K' : kidnap ? 'k' : '-')
  while (p.recent.length > Math.max(l.window, 10)) p.recent.shift()
  let unlocked: number | undefined
  if (!p.passed && l.window > 0 && meetsPass(l, p)) {
    p.passed = true
    if (n + 1 <= LEVELS.length && progress.unlocked < n + 1) {
      progress.unlocked = n + 1
      unlocked = n + 1
    }
  }
  saveJson(FILE, progress)
  return unlocked
}

export function passProgress(l: Level, p: LevelProgress): { kidnaps: number; kills: number } {
  const win = p.recent.slice(-l.window)
  let kidnaps = 0
  let kills = 0
  for (const r of win) {
    if (r !== '-') kidnaps++
    if (r === 'K') kills++
  }
  return { kidnaps, kills }
}

function meetsPass(l: Level, p: LevelProgress): boolean {
  const c = passProgress(l, p)
  return c.kidnaps >= l.need && c.kills >= l.kills
}

export function passRuleText(l: Level): string {
  if (l.window === 0) return 'Endless: beat your best streak'
  const base = l.need === l.window ? `${l.need} kidnaps in a row` : `${l.need} kidnaps in your last ${l.window}`
  return l.kills > 0 ? `${base}, ${l.kills}+ kills` : base
}

export function resetProgress(): void {
  progress.unlocked = 1
  progress.levels = {}
  saveJson(FILE, progress)
}
