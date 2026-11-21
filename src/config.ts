import { clamp, loadJson, saveJson } from './util'

export type Behaviour = 'still' | 'walk' | 'fight'
export const BEHAVIOURS: readonly Behaviour[] = ['still', 'walk', 'fight']
export const BEHAVIOUR_TITLES: readonly string[] = ['Stand still', 'Strafing, no attacks', 'Full AI']

// The game's bot difficulties (scripts/bots/bot_difficulty.vdata): 1 Easy,
// 2 Medium, 3 Hard. (5 is the tutorial's guided bot; there is no 4.)
export const DIFFICULTY_TITLES: readonly string[] = ['Easy', 'Medium', 'Hard']
export const MAX_DIFFICULTY = 3

export type SpotFilter = 'any' | 'close' | 'far'
export type PerMode = { ladder: boolean; endless: boolean; custom: boolean; midboss: boolean }
// Real: the game's cooldowns. Short: 3 s. None: abilities and items are always ready.
export type CooldownMode = 'real' | 'short' | 'none'

// Starting items, given free on every rebuild. Class names from the shop table;
// hovering an item in the menu shows its in-game shop card.
export const VORTEX_WEB = 'upgrade_aoe_root'
export const ITEM_PRESETS: readonly { name: string; items: readonly string[] }[] = [
  {
    // Trophy Collector, Greater Expansion, Cheat Death, Vortex Web,
    // Rapid Recharge, Superior Duration.
    name: 'Doorman build',
    items: ['upgrade_trophy_collector', 'upgrade_tech_range', 'upgrade_cheat_death', VORTEX_WEB, 'upgrade_rapid_recharge', 'upgrade_imbued_duration_extender'],
  },
  { name: 'Vortex Web only', items: [VORTEX_WEB] },
  { name: 'None', items: [] },
]
// Items the menu offers to toggle: the default build first, then other
// setup, spirit, mobility and survival picks.
export const ITEM_CHOICES: readonly string[] = [
  ...ITEM_PRESETS[0].items,
  'upgrade_target_stun', // Knockdown
  'upgrade_targeted_silence', // Silence Glyph
  'upgrade_magic_slow', // Mystic Slow
  'upgrade_cold_front',
  'upgrade_ability_refresher', // Refresher
  'upgrade_ability_power_shard', // Echo Shard
  'upgrade_cooldown_reduction', // Superior Cooldown
  'upgrade_magic_reach', // Mystic Reach
  'upgrade_improved_spirit',
  'upgrade_magic_burst', // Mystic Burst
  'upgrade_improved_stamina',
  'upgrade_sprint_booster',
  'upgrade_warp_stone',
  'upgrade_metal_skin',
]
// Bumped when the default build changes, so saved settings pick it up once.
export const ITEMS_VERSION = 3
export type DetectMode = 'track' | 'radius'

export interface Settings {
  mode: 'ladder' | 'custom' | 'endless' | 'midboss'
  midboss: { enemies: number; allies: number; difficulty: number; duration: number; respawn: number }
  endlessDifficulty: number // 1-3, the base difficulty of an endless run
  level: number // 1-based ladder level
  team: number // 2 or 3
  // Custom-mode bot settings (the ladder overrides them).
  enemies: number
  allies: number
  heroPool: string[] // hero_* names; empty = every hero
  rerollEvery: number // rounds; 0 = never
  behaviour: Behaviour
  moves: { jump: boolean; slide: boolean; dash: boolean } // with Walk
  difficulty: number
  spotFilter: SpotFilter
  // Rules.
  fightSec: number
  followSec: number // after a kidnap, the fight runs on this long before the result
  redoor: boolean // doors gone mid-fight: back to door 1's spot, then back where you were
  autoAdvance: boolean // ladder: passing a level moves you up to the next
  shortVortex: PerMode // Vortex Web on a 3 s cooldown, per mode
  shortCart: PerMode // Luggage Cart on a 3 s cooldown, per mode
  botAi: 'trainer' | 'game' // who drives full-AI bots: the trainer's fighter, or the game's own brain
  version: number // settings format, for one-time default changes
  resultSec: number
  autoNext: boolean // continue by itself after the result screen
  afterMiss: 'next' | 'retry' // what auto-continue does after a miss
  souls: number
  maxAbilities: boolean // every ability fully upgraded, whatever the souls
  items: string[] // starting items for Doorman
  itemsVersion: number
  cooldowns: CooldownMode
  invincible: boolean // damage to you is blocked
  rangeUpgrade: boolean
  troopers: boolean
  // Locations: ids of the selected ones; empty = all.
  locations: string[]
  hiddenSpots: string[] // fight spots hidden with /badspot
  // Tuning.
  unitsPerMetre: number
  detect: DetectMode
  jumpUnits: number
  cartWindowSec: number
  kidnapRadius: number
}

export const DEFAULTS: Settings = {
  mode: 'ladder',
  midboss: { enemies: 4, allies: 2, difficulty: 2, duration: 60, respawn: 15 },
  endlessDifficulty: 2,
  level: 1,
  team: 2,
  enemies: 6,
  allies: 0,
  heroPool: [],
  rerollEvery: 5,
  behaviour: 'fight',
  moves: { jump: false, slide: false, dash: false },
  difficulty: 2,
  spotFilter: 'any',
  fightSec: 30,
  followSec: 4,
  redoor: true,
  autoAdvance: true,
  shortVortex: { ladder: false, endless: false, custom: false, midboss: false },
  shortCart: { ladder: false, endless: false, custom: false, midboss: false },
  botAi: 'trainer',
  version: 2,
  resultSec: 3,
  autoNext: true,
  afterMiss: 'next',
  souls: 20000,
  maxAbilities: true,
  items: ITEM_PRESETS[0].items.slice(),
  itemsVersion: ITEMS_VERSION,
  cooldowns: 'real',
  invincible: false,
  rangeUpgrade: false,
  troopers: false,
  locations: [],
  hiddenSpots: [],
  unitsPerMetre: 39.37,
  detect: 'track',
  jumpUnits: 600,
  cartWindowSec: 3,
  kidnapRadius: 1500,
}

const FILE = 'settings.json'

export const settings: Settings = Object.assign({}, DEFAULTS, loadJson<Partial<Settings>>(FILE, {}))
sanitize()

export function sanitize(): void {
  const s = settings
  s.team = s.team === 3 ? 3 : 2
  if (s.mode !== 'custom' && s.mode !== 'endless' && s.mode !== 'midboss') s.mode = 'ladder'
  const mb = (s.midboss ?? {}) as Partial<Settings['midboss']>
  s.midboss = {
    enemies: clamp(Math.round(mb.enemies ?? 4), 2, 6),
    allies: clamp(Math.round(mb.allies ?? 2), 0, 4),
    difficulty: clamp(Math.round(mb.difficulty ?? 2), 1, MAX_DIFFICULTY),
    duration: clamp(Math.round(mb.duration ?? 60), 30, 120),
    respawn: clamp(Math.round(mb.respawn ?? 15), 5, 30),
  }
  s.endlessDifficulty = clamp(Math.round(s.endlessDifficulty), 1, MAX_DIFFICULTY)
  s.enemies = clamp(Math.round(s.enemies), 1, 6)
  s.allies = clamp(Math.round(s.allies), 0, 5)
  s.difficulty = clamp(Math.round(s.difficulty), 1, MAX_DIFFICULTY)
  s.fightSec = clamp(s.fightSec, 10, 90)
  if (!(s.version >= 2)) {
    s.followSec = 4 // new default watch time
    s.version = 2
  }
  s.redoor = s.redoor !== false
  s.autoAdvance = s.autoAdvance !== false
  const sv = (s.shortVortex ?? {}) as Partial<Settings['shortVortex']>
  s.shortVortex = { ladder: sv.ladder === true, endless: sv.endless === true, custom: sv.custom === true, midboss: sv.midboss === true }
  const sc = (s.shortCart ?? {}) as Partial<Settings['shortCart']>
  s.shortCart = { ladder: sc.ladder === true, endless: sc.endless === true, custom: sc.custom === true, midboss: sc.midboss === true }
  s.botAi = s.botAi === 'game' ? 'game' : 'trainer'
  s.followSec = clamp(Math.round(s.followSec * 2) / 2, 0, 5)
  s.resultSec = clamp(s.resultSec, 1, 10)
  s.souls = clamp(Math.round(s.souls), 0, 60000)
  s.rerollEvery = clamp(Math.round(s.rerollEvery), 0, 50)
  if (BEHAVIOURS.indexOf(s.behaviour) < 0) s.behaviour = 'fight'
  const mv = (s.moves ?? {}) as Partial<Settings['moves']>
  s.moves = { jump: mv.jump === true, slide: mv.slide === true, dash: mv.dash === true }
  s.autoNext = s.autoNext !== false
  s.maxAbilities = s.maxAbilities !== false
  // Older settings had a fastCooldowns switch.
  const old = s as unknown as { fastCooldowns?: boolean }
  if (s.cooldowns !== 'short' && s.cooldowns !== 'none') s.cooldowns = old.fastCooldowns ? 'short' : 'real'
  delete old.fastCooldowns
  s.invincible = s.invincible === true
  s.afterMiss = s.afterMiss === 'retry' ? 'retry' : 'next'
  if (!Array.isArray(s.heroPool)) s.heroPool = []
  if (!Array.isArray(s.items) || s.itemsVersion !== ITEMS_VERSION) {
    s.items = ITEM_PRESETS[0].items.slice()
    s.itemsVersion = ITEMS_VERSION
  }
  if (!Array.isArray(s.locations)) s.locations = []
  if (!Array.isArray(s.hiddenSpots)) s.hiddenSpots = []
  if (!(s.unitsPerMetre > 1)) s.unitsPerMetre = DEFAULTS.unitsPerMetre
}

// Back to defaults, keeping your side, ladder level and location selection.
export function resetSettings(): void {
  const keep = { team: settings.team, level: settings.level, mode: settings.mode, locations: settings.locations }
  Object.assign(settings, JSON.parse(JSON.stringify(DEFAULTS)), keep)
  saveSettings()
}

export function saveSettings(): void {
  sanitize()
  saveJson(FILE, settings)
}

// Doorway Distance (max distance between the two doors), in game units.
export function doorRangeUnits(): number {
  return (70 + (settings.rangeUpgrade ? 40 : 0)) * settings.unitsPerMetre
}

// Practice aids make tries easier than the real thing: with any on, ladder
// progress and endless best scores aren't saved.
// (Ladder levels with built-in 3 s cooldowns don't count as aids.)
export function practiceAids(): boolean {
  return settings.invincible || settings.cooldowns !== 'real' || settings.shortVortex[settings.mode] || settings.shortCart[settings.mode]
}

export function enemyTeam(): number {
  return settings.team === 2 ? 3 : 2
}

export function teamTitle(team: number): string {
  return team === 2 ? 'Amber' : team === 3 ? 'Sapphire' : `Team ${team}`
}
