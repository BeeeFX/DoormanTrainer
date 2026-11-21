import { addBot, heroes, type Hero, type Player } from 'modlock'
import { set } from 'modlock/console'
import { enemyTeam, settings, type Behaviour } from './config'
import { buildHero, DOORMAN } from './build'
import type { Effective } from './levels'
import { dbg, log, shuffle } from './util'

export interface Bot {
  player: Player
  hero: Hero
  enemy: boolean
  built: boolean // build applied since its last spawn
}

let roster: Bot[] = []
let rosterKey = ''
let roundsSinceRoll = 0

// Heroes a bot may play: everything but Doorman and test heroes.
export function heroChoices(): Hero[] {
  return heroes.filter((h) => h.name !== DOORMAN && h.name.indexOf('test') < 0 && h.title !== '')
}

function heroPool(): Hero[] {
  const all = heroChoices()
  if (settings.heroPool.length === 0) return all
  const chosen = all.filter((h) => settings.heroPool.indexOf(h.name) >= 0)
  return chosen.length > 0 ? chosen : all
}

export function bots(): readonly Bot[] {
  return roster
}
export function enemies(): Bot[] {
  return roster.filter((b) => b.enemy)
}
export function allies(): Bot[] {
  return roster.filter((b) => !b.enemy)
}
export function botFor(player: Player): Bot | undefined {
  for (const b of roster) if (b.player.slot === player.slot) return b
  return undefined
}

export function removeAll(): void {
  for (const b of roster) b.player.removeBot()
  roster = []
  rosterKey = ''
}

export function applyBehaviour(b: Behaviour): void {
  set('citadel_bot_brain_disable_movement', b === 'still')
  set('citadel_bot_brain_disable_attacks', b !== 'fight')
}

// Makes the roster match the effective settings; rebuilds when counts, team,
// difficulty or pool changed, or when it's time to reroll heroes.
// Returns true when bots were (re)created this call.
export function ensureRoster(eff: Effective, newRound: boolean): boolean {
  applyBehaviour(eff.behaviour)
  const key = [eff.enemies, eff.allies, settings.team, eff.difficulty, eff.behaviour, settings.heroPool.join(','), settings.souls].join('|')
  if (newRound) roundsSinceRoll++
  const reroll = settings.rerollEvery > 0 && roundsSinceRoll >= settings.rerollEvery
  if (key === rosterKey && !reroll && roster.length > 0) return false

  removeAll()
  roundsSinceRoll = 0
  set('citadel_default_bot_difficulty', eff.difficulty)
  const pool = shuffle(heroPool())
  const want = eff.enemies + eff.allies
  let made = 0
  // A hero the game refuses is skipped for the next one in the pool.
  let next = 0
  for (let i = 0; i < want; i++) {
    const enemy = i < eff.enemies
    const team = enemy ? enemyTeam() : settings.team
    let added = false
    for (let tries = 0; tries < pool.length && !added; tries++) {
      const hero = pool[next++ % pool.length]
      const p = addBot({ name: enemy ? `Guest ${i + 1}` : `Bellhop ${i - eff.enemies + 1}`, team, hero: hero.name })
      if (!p) {
        log(`addBot refused ${hero.name}; trying another hero`)
        continue
      }
      roster.push({ player: p, hero, enemy, built: false })
      made++
      added = true
    }
  }
  rosterKey = key
  dbg(`roster: ${made}/${want} bots, difficulty ${eff.difficulty}`)
  return true
}

// Called from onSpawn: a bot gets the player's build on its first spawn.
// Respawns keep the build, so they are skipped.
export function onBotSpawn(player: Player): void {
  const b = botFor(player)
  if (!b) return
  if (b.built) return
  b.built = true
  buildHero(player, settings.souls, false, undefined, undefined, settings.maxAbilities)
}

export function markAllForRebuild(): void {
  for (const b of roster) b.built = false
}

export function forceReroll(): void {
  rosterKey = ''
}
