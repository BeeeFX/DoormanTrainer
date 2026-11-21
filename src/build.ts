import { after, item, type Player } from 'modlock'
import { settings, VORTEX_WEB, type CooldownMode } from './config'
import { dbg, log } from './util'

export const DOORMAN = 'hero_doorman'
export const AB_DOORWAY = 'ability_doorman_doorway'
export const AB_CART = 'ability_doorman_luggage_cart'
export const AB_HOTEL = 'ability_doorman_hotel'

// Ability points a hero holding `souls` should have, roughly: 0 AP at 0 souls,
// every upgrade of every ability (4 × 8 = 32) at 45k souls.
export function targetAbilityPoints(souls: number): number {
  return Math.max(0, Math.min(32, Math.round((souls / 45000) * 32)))
}

// Upgrade order after unlocking all four: Doorman maxes Doorway, then Cart,
// Bell, Hotel Guest; bots go round-robin. Tier costs are 1, 2 and 5 AP.
const DOORMAN_ORDER = [1, 1, 1, 2, 2, 2, 0, 0, 0, 3, 3, 3]
const BOT_ORDER = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]
const TIER_COST = [1, 2, 5]

// Tiers per slot (0 = just unlocked, 3 = maxed) that `points` buy in `order`.
export function plannedTiers(points: number, order: readonly number[]): number[] {
  const tiers = [0, 0, 0, 0]
  let left = points
  for (const slot of order) {
    const t = tiers[slot]
    if (t >= 3) continue
    const cost = TIER_COST[t]
    if (cost > left) continue
    left -= cost
    tiers[slot] = t + 1
  }
  return tiers
}

// Upgrades bitmask: bit 0 unlocks, bits 1-3 are the tiers.
function mask(tiers: number): number {
  return (1 << (tiers + 1)) - 1
}

// Rebuilds the hero with `souls`, sets its ability upgrades for the matching
// ability points, then gives the starting items. resetHero clears levels and
// points, so upgrades are set directly (setAbility); if the game refuses,
// training falls back to granting exactly what each step costs. `done`
// always runs, even when the pawn never shows, so nothing waits on it.
export function buildHero(player: Player, souls: number, doorman: boolean, done?: () => void, startItems?: readonly string[], maxAll = false): void {
  player.resetHero(souls)
  let tries = 0
  const finish = () => {
    if (done) done()
  }
  const step = () => {
    const pawn = player.pawn()
    const abilities = pawn ? player.abilities().filter((a) => a.slot >= 0 && a.slot <= 3) : []
    if (!pawn || pawn.health <= 0 || abilities.length < 4) {
      if (++tries < 16) after(0.3, step)
      else {
        log(`build slot ${player.slot}: no hero after the reset, skipped`)
        finish()
      }
      return
    }
    const tiers = maxAll ? [3, 3, 3, 3] : plannedTiers(targetAbilityPoints(souls), doorman ? DOORMAN_ORDER : BOT_ORDER)
    let set = 0
    let trained = 0
    for (const a of abilities) {
      const want = mask(tiers[a.slot])
      if ((a.upgrades & want) === want) continue
      if (player.setAbility({ ability: a.name, upgrades: want })) set++
      else trained += trainTo(player, a.slot, tiers[a.slot])
    }
    const given = startItems ? giveItems(player, startItems) : 0
    dbg(`built slot ${player.slot}: souls ${souls}, tiers ${tiers.join('/')}, ${set} set, ${trained} trained, ${given} items`)
    finish()
  }
  after(0.3, step)
}

// Fallback: train a slot up to `tiers`, granting the unlock or the exact AP
// each step costs right before it, and taking it back if the game refuses.
function trainTo(player: Player, slot: number, tiers: number): number {
  let done = 0
  for (let step = 0; step <= tiers; step++) {
    const a = player.abilities().find((x) => x.slot === slot)
    if (!a) break
    const have = a.upgrades & 1 ? countBits(a.upgrades) - 1 : -1 // -1 = not unlocked
    if (have >= step) continue
    const unlock = have < 0
    const cost = unlock ? 0 : TIER_COST[have]
    player.adjustAbilityPoints(cost, unlock ? 1 : 0)
    if (player.trainAbility(slot)) done++
    else {
      player.adjustAbilityPoints(-cost, unlock ? -1 : 0)
      break
    }
  }
  return done
}

function countBits(n: number): number {
  let c = 0
  for (let v = n; v > 0; v >>= 1) c += v & 1
  return c
}

// Gives items for free (souls stay for ability points). Unknown names are
// skipped, so a game update that renames an item can't break the build.
export function giveItems(player: Player, names: readonly string[]): number {
  let n = 0
  for (const name of names) {
    if (!item(name)) {
      log(`unknown item ${name}, skipped`)
      continue
    }
    if (player.giveItem(name)) n++
    else dbg(`giveItem ${name} refused`)
  }
  return n
}

// Makes every ability and active item ready now, and sets the cooldown length
// for the mode: Short = 3 s, None = 0. Real leaves the game's lengths (a hero
// rebuild restores them after Short or None).
export function resetCooldowns(player: Player, mode: CooldownMode, keepDoorway = false, shortVortex = false, shortCart = false): void {
  for (const a of player.abilities()) {
    // Refreshing Doorway takes down the doors already placed.
    if (keepDoorway && a.name.toLowerCase().indexOf('doorway') >= 0) continue
    player.refreshAbility(a.name)
    if (mode === 'short') player.setAbility({ ability: a.name, cooldownEnd: 0, cooldown: 3 })
    else if (mode === 'none') player.setAbility({ ability: a.name, cooldownEnd: 0, cooldown: 0 })
    // Luggage Cart on its own 3 s cooldown (the mode's switch).
    else if (shortCart && a.name.toLowerCase().indexOf('cart') >= 0) player.setAbility({ ability: a.name, cooldownEnd: 0, cooldown: 3 })
    else player.setAbility({ ability: a.name, cooldownEnd: 0 })
  }
  // Vortex Web is an item: set it by name too, in case the ability list
  // doesn't include item actives.
  if (settings.items.indexOf(VORTEX_WEB) < 0) return
  player.refreshAbility(VORTEX_WEB)
  if (mode === 'none') player.setAbility({ ability: VORTEX_WEB, cooldownEnd: 0, cooldown: 0 })
  else if (shortVortex || mode === 'short') player.setAbility({ ability: VORTEX_WEB, cooldownEnd: 0, cooldown: 3 })
}

export function refresh(player: Player): void {
  player.heal(100000)
  player.restoreStamina()
}
