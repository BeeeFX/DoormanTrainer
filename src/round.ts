import { after, entityPosition, modifiers, vector, type AbilityCastEvent, type KillEvent, type LaunchEvent, type Player, type Vector } from 'modlock'
import { allies, bots, ensureRoster, enemies, type Bot } from './bots'
import { buildHero, refresh, resetCooldowns } from './build'
import { DIFFICULTY_TITLES, practiceAids, saveSettings, settings } from './config'
import { closeDoors, doorEntities, doorPositions } from './doors'
import { effective, LEVELS, recordLevelResult } from './levels'
import { allLocations, generateBuiltins, mapSummary, midbossPick, pickRound, selectionKey, spotKey, type Pick } from './locations'
import { placeAllies, placeEnemies, placeInPit, type Placed } from './placement'
import { recordRound, stats } from './stats'
import { isSuccess, OUTCOME_TIPS, OUTCOME_TITLES, Tracker, type EnemySample, type Outcome } from './tracker'
import { dbg, log, now, onClockReset } from './util'
import { currentFight as currentMidboss, drain, endFight as endMidboss, kidnapped, PIT_HEIGHT, PIT_RADIUS, recordFight as recordMidboss, score as midbossScore, startFight as startMidboss, type Fight as MidbossFight } from './midboss'
import { fight, hitBoss, leaveBoss, observe, release, stopWalking, walk } from './walker'
import { bossState, ensureBoss, removeBoss, removeSpawnedBoss, setBossPercent } from './boss'
import { beginWave, clearWave, currentRun, endRun, outCount, recordRun, scoreKidnap, startRun, waveSeconds, type Run } from './endless'

export type Phase = 'idle' | 'setup' | 'fight' | 'follow' | 'result'

export interface BannerState {
  title: string
  detail: string
  tone: 'success' | 'danger' | 'accent' | 'amber'
  until: number
}

interface Round {
  pick: Pick
  tracker: Tracker
  enemySpots: Placed[]
  allySpots: Placed[]
  placed: Record<number, boolean>
  respawned: Record<number, boolean>
  setupStart: number
  doorPlacedAt: number
  victim: number // bot slot, -1 = none
  victimDied: boolean
  outcome: Outcome | undefined
  levelAtStart: number // 0 = custom
  humanPlaced: boolean
  humanBuilding: boolean // a hero rebuild is in flight; place the player after it
  lastRespawnTry: number
  oldDoors: Record<number, boolean> // door entities that existed when setup began
  oldDoorsTaken: boolean
  redoor: boolean // endless: the doors closed mid-wave; door 1 again, same wave
  redoorLeft: number // fight seconds left when the doors closed
  returnTo: { pos: Vector; facing: { pitch: number; yaw: number; roll: number } } | undefined
  doorsSeenAt: number // last time any door stood during the fight
}

// What a retry repeats: the same spot, the same bot positions.
interface Plan {
  pick: Pick
  enemySpots: Placed[]
  allySpots: Placed[]
}

let human: Player | undefined
let phase: Phase = 'idle'
let phaseUntil = 0
let running = false // the loop continues after RESULT
let round: Round | undefined
let lastPlan: Plan | undefined
let lastOutcome: Outcome | undefined
let banner: BannerState | undefined
// The player's last mod teleport, so a fall through the floor right after it
// can be caught and undone.
let guard: { pos: Vector; facing: { pitch: number; yaw: number; roll: number }; until: number } | undefined
// Once the game's bot brain is seen idling in a fight, the mod's scripted
// fighter drives full-AI bots from then on.
let scriptedFight = false
let fightStartPos: Record<number, Vector> = {}
let brainCheckAt = -1
let resultStart = -100
// Endless: the result screen between two waves (keys do nothing there), and
// the summary of the last finished run.
let waveBreak = false
let lastRunSummary: { wave: number; score: number; best: boolean; difficulty: number } | undefined
let rebuildPending = false
let builtSouls = -1
let builtItems = ''
let lastCooldowns = 'real'
const cartIds: Record<number, boolean> = {}
const seenModifiers: Record<string, boolean> = {}

export function setHuman(p: Player | undefined): void {
  human = p
}
export function getHuman(): Player | undefined {
  return human
}
export function currentPhase(): Phase {
  return phase
}
export function isRunning(): boolean {
  return running
}
export function timeLeft(): number {
  return Math.max(0, phaseUntil - now())
}
export function currentRound(): Round | undefined {
  return round
}
export function currentBanner(): BannerState | undefined {
  if (banner && now() > banner.until) banner = undefined
  return banner
}
export function showBanner(title: string, detail: string, tone: BannerState['tone'], seconds: number): void {
  banner = { title, detail, tone, until: now() + seconds }
}

// Teleports the player a little above the spot with no leftover speed, and
// watches for a fall through the floor for the next 2 s.
function moveHuman(pos: Vector, facing: { pitch: number; yaw: number; roll: number }): void {
  if (!human) return
  const lifted = { x: pos.x, y: pos.y, z: pos.z + 20 }
  human.teleport(lifted, facing, { x: 0, y: 0, z: 0 })
  guard = { pos: lifted, facing, until: now() + 2 }
}

function fallGuard(): void {
  if (!human || !guard) return
  if (now() > guard.until) {
    guard = undefined
    return
  }
  const pawn = human.pawn()
  if (pawn && pawn.position.z < guard.pos.z - 300) {
    log(`fell through the floor near ${Math.round(guard.pos.x)}, ${Math.round(guard.pos.y)}, ${Math.round(guard.pos.z)}: put back`)
    const up = { x: guard.pos.x, y: guard.pos.y, z: guard.pos.z + 40 }
    human.teleport(up, guard.facing, { x: 0, y: 0, z: 0 })
    guard = { pos: up, facing: guard.facing, until: now() + 2 }
  }
}

onClockReset(() => {
  banner = undefined
  guard = undefined
})

function alive(p: Player): boolean {
  const pawn = p.pawn()
  return pawn !== undefined && pawn.health > 0
}

// ---- player build ----

export function rebuildHuman(force: boolean): void {
  if (!human) return
  const cooldowns = effective().cooldowns
  const itemsKey = settings.items.join(',') + (settings.maxAbilities ? '|max' : '') + (effective().shortVortex ? '' : '|vw-real') + (effective().shortCart ? '' : '|cart-real')
  if (force || builtSouls !== settings.souls || builtItems !== itemsKey || (lastCooldowns !== 'real' && cooldowns === 'real')) {
    builtSouls = settings.souls
    builtItems = itemsKey
    rebuildPending = true
    if (round) round.humanBuilding = true
    buildHero(human, settings.souls, true, () => {
      rebuildPending = false
      // resetHero can move the hero and undo cooldown tweaks: place again.
      if (round) {
        round.humanBuilding = false
        if (phase === 'setup') round.humanPlaced = false
      }
    }, settings.items, settings.maxAbilities)
  }
  lastCooldowns = cooldowns
}

// When the result screen began; quick keys ignore presses right after it, so a
// reload or jump from the fight doesn't fire Retry or Next by habit.
export function resultAge(): number {
  return phase === 'result' ? now() - resultStart : 1000
}

// ---- loop control ----

export function start(): string | undefined {
  if (!human) return 'No player to train.'
  rebuildHuman(false)
  running = true
  if (allLocations(settings.team).length === 0 || mapSummary().guardians === 0) generateBuiltins()
  if (phase === 'idle') {
    if (settings.mode === 'endless') {
      startRun(settings.endlessDifficulty)
      lastRunSummary = undefined
    }
    beginSetup(false)
  }
  return undefined
}

export function isWaveBreak(): boolean {
  return phase === 'result' && waveBreak
}
export function lastRun(): typeof lastRunSummary {
  return lastRunSummary
}
function endlessRun(): Run | undefined {
  return settings.mode === 'endless' ? currentRun() : undefined
}
// Bots kidnapped this wave stay frozen out of the way when they respawn.
export function holdBot(slot: number): boolean {
  const r = endlessRun()
  if (r !== undefined && r.out[slot] === true) return true
  const m = midbossFight()
  return m !== undefined && m.out[slot] !== undefined && now() < m.out[slot]
}
function midbossFight(): MidbossFight | undefined {
  return settings.mode === 'midboss' ? currentMidboss() : undefined
}
let pitCount = 0
let realBoss = false // the fight uses the real Mid-Boss's health
export function enemiesInPit(): number {
  return pitCount
}
let lastMidboss: { won: boolean; score: number; kidnaps: number; hp: number; best: boolean } | undefined
export function lastMidbossResult(): typeof lastMidboss {
  return lastMidboss
}

export function hasLastPlan(): boolean {
  return lastPlan !== undefined && lastPlan.pick.location.team === settings.team
}

// Forget the last setup: after a map change or a side switch it points at
// spots that no longer apply.
export function clearPlan(): void {
  lastPlan = undefined
}

// Ends a running round early. A kidnap already detected still counts; in the
// ladder, bailing out after the cart was thrown counts as the miss it was, so
// "N in a row" can't be farmed by restarting every miss.
function abort(quiet: boolean): void {
  stopWalking()
  if (settings.mode === 'endless') {
    // Leaving a run mid-way (menu, restart, stop) ends it without a score.
    if (currentRun() && (phase === 'setup' || phase === 'fight')) {
      endRun()
      closeDoors()
      if (!quiet) showBanner('Run abandoned', '', 'accent', 2)
    }
    if (phase === 'setup' || phase === 'fight') {
      round = undefined
      phase = 'result'
      resultStart = now()
      waveBreak = false
      phaseUntil = Number.POSITIVE_INFINITY
    }
    return
  }
  if (!round) return
  if (phase === 'follow') return finish('kidnap', quiet)
  const fighting = phase === 'fight' || round.redoor
  if (fighting && round.levelAtStart > 0 && round.tracker.cartCasts > 0) return finish(round.tracker.missReason(), quiet)
  if (phase === 'setup' || phase === 'fight') finish('skipped', quiet)
}
export function lastResult(): Outcome | undefined {
  return lastOutcome
}

// Ends the current round uncounted (if one runs) and starts again at once:
// the same setup for retry, a new one for next.
function chain(reuse: boolean): void {
  if (!human) return
  rebuildHuman(false)
  running = true
  abort(true)
  round = undefined
  if (settings.mode === 'endless') {
    // In endless, retry and next both mean a fresh run.
    startRun(settings.endlessDifficulty)
    lastRunSummary = undefined
    beginSetup(false)
    showBanner('New run', `Endless · ${DIFFICULTY_TITLES[settings.endlessDifficulty - 1]}`, 'accent', 1.5)
    return
  }
  beginSetup(reuse && hasLastPlan())
  showBanner(reuse ? 'Retry' : 'Next setup', '', 'accent', 1.2)
}
export function retry(): void {
  chain(true)
}
export function next(): void {
  chain(false)
}

// An Endless wave break left by the menu or /stop: the run ends there.
function leaveWaveBreak(): void {
  if (!waveBreak) return
  waveBreak = false
  endRun()
}

export function stop(): void {
  running = false
  abort(false)
  leaveWaveBreak()
  phase = 'idle'
  round = undefined
  for (const b of bots()) b.player.freeze(false)
  if (human) human.freeze(false)
}

// Pause for the menu: end the round uncounted and hold everyone still.
export function pause(): void {
  running = false
  abort(false)
  leaveWaveBreak()
  phase = 'idle'
  round = undefined
  for (const b of bots()) b.player.freeze(true)
}

export function skip(): void {
  abort(false)
}

// ---- phases ----

function beginSetup(reuse: boolean): void {
  if (!human) return
  waveBreak = false
  // Moving between levels or modes can change cooldowns or the build.
  rebuildHuman(false)
  // With "Game's own" bots, check afresh each round whether the brain idles.
  if (settings.botAi === 'game') scriptedFight = false
  const eff = effective()
  const pick = reuse && lastPlan && hasLastPlan() ? lastPlan.pick : settings.mode === 'midboss' ? midbossPick(settings.team) : pickRound(settings.team, eff.spotFilter)
  if (!pick) {
    showBanner('No locations', 'Open /dt → Locations, or record one with /tower and /fight', 'danger', 6)
    running = false
    phase = 'idle'
    return
  }
  closeDoors()
  ensureRoster(eff, !reuse)
  const fight = pick.location.fights[pick.fightIndex]
  // A retry keeps the bot positions, unless the bot counts changed since.
  const keep = reuse && lastPlan !== undefined && lastPlan.enemySpots.length === eff.enemies && lastPlan.allySpots.length === eff.allies
  const pit = pick.location.pit ?? fight
  if (settings.mode === 'midboss') ensureBoss(pit.pos, pit.facing)
  else removeSpawnedBoss()
  const enemySpots = keep && lastPlan ? lastPlan.enemySpots : settings.mode === 'midboss' ? placeInPit(pit, eff.enemies, fight.pos) : placeEnemies(fight, eff.enemies)
  const allySpots = keep && lastPlan ? lastPlan.allySpots : placeAllies(fight, pick.location.anchor, eff.allies, pick.location.alliesAtAnchor, enemySpots.map((s) => s.pos))
  lastPlan = { pick, enemySpots, allySpots }
  round = {
    pick,
    tracker: new Tracker(
      { mode: settings.detect, jumpUnits: settings.jumpUnits, cartWindowSec: settings.cartWindowSec, kidnapRadius: settings.kidnapRadius },
      pick.location.anchor.pos,
    ),
    enemySpots,
    allySpots,
    placed: {},
    respawned: {},
    setupStart: now(),
    doorPlacedAt: -1,
    victim: -1,
    victimDied: false,
    outcome: undefined,
    levelAtStart: settings.mode === 'ladder' ? settings.level : 0,
    humanPlaced: false,
    oldDoors: {},
    oldDoorsTaken: false,
    redoor: false,
    redoorLeft: 0,
    returnTo: undefined,
    doorsSeenAt: -1,
    humanBuilding: rebuildPending,
    lastRespawnTry: now(),
  }
  human.freeze(false)
  if (!alive(human)) human.respawn()
  placeHuman()
  phase = 'setup'
  // No clock in setup: the fight starts as soon as door 1 is down.
  phaseUntil = Number.POSITIVE_INFINITY
  dbg(`setup: ${pick.location.name} fight ${pick.fightIndex + 1}`)
}

// Puts the player at the anchor, ready to cast door 1. A dead player respawns
// first, and the teleport waits for the new pawn.
function placeHuman(): void {
  if (!human || !round || round.humanPlaced || round.humanBuilding || !alive(human)) return
  const a = round.pick.location.anchor
  moveHuman(a.pos, a.facing)
  refresh(human)
  resetCooldowns(human, effective().cooldowns, false, effective().shortVortex, effective().shortCart)
  round.humanPlaced = true
}

function spotFor(b: Bot): Placed | undefined {
  if (!round) return undefined
  const list = b.enemy ? round.enemySpots : round.allySpots
  const group = b.enemy ? enemies() : allies()
  const i = group.indexOf(b)
  return i >= 0 ? list[i] : undefined
}

// Puts each bot at its spot and holds it there. Bots spawn a few frames after
// addBot, and dead ones respawn first, so this runs every setup frame.
function placeBots(): boolean {
  if (!round) return true
  let all = true
  for (const b of bots()) {
    const s = spotFor(b)
    if (!s) continue
    const slot = b.player.slot
    if (!alive(b.player)) {
      all = false
      if (!round.respawned[slot]) {
        round.respawned[slot] = true
        b.player.respawn()
      }
      continue
    }
    if (!round.placed[slot]) {
      b.player.freeze(false)
      b.player.teleport(s.pos, s.facing)
      b.player.freeze(true)
      refresh(b.player)
      round.placed[slot] = true
    }
  }
  return all
}

function beginFight(): void {
  if (!human || !round) return
  if (round.redoor) return resumeFight()
  const fight = round.pick.location.fights[round.pick.fightIndex]
  moveHuman(fight.pos, fight.facing)
  refresh(human)
  const r = endlessRun()
  for (const b of bots()) {
    const s = spotFor(b)
    if (!s || !alive(b.player)) continue
    if (r && r.out[b.player.slot]) continue // kidnapped this wave: stays out
    b.player.teleport(s.pos, s.facing)
    b.player.freeze(false)
    refresh(b.player)
  }
  round.tracker.startFight(now())
  round.doorsSeenAt = now()
  fightStartPos = {}
  for (const b of enemies()) {
    const p = b.player.pawn()
    if (p) fightStartPos[b.player.slot] = p.position
  }
  brainCheckAt = now() + 2.5
  phase = 'fight'
  if (r) {
    beginWave(r, now())
    phaseUntil = now() + waveSeconds(r.wave)
  } else if (settings.mode === 'midboss') {
    const pit = round.pick.location.pit ?? fight
    realBoss = ensureBoss(pit.pos, pit.facing) !== undefined
    startMidboss(now())
    phaseUntil = now() + settings.midboss.duration
  } else phaseUntil = now() + settings.fightSec
}

// Back from re-placing door 1: you return exactly where you were, the bots
// carry on from where they stood, and the clock resumes.
function resumeFight(): void {
  if (!human || !round) return
  round.redoor = false
  if (round.returnTo) moveHuman(round.returnTo.pos, round.returnTo.facing)
  const r = endlessRun()
  for (const b of bots()) {
    if (r && r.out[b.player.slot]) continue
    if (alive(b.player)) b.player.freeze(false)
  }
  round.tracker.forgetPositions(now())
  round.doorsSeenAt = now()
  fightStartPos = {}
  for (const b of enemies()) {
    const p = b.player.pawn()
    if (p) fightStartPos[b.player.slot] = p.position
  }
  brainCheckAt = now() + 2.5
  phase = 'fight'
  phaseUntil = now() + round.redoorLeft
  showBanner('Back in', '', 'accent', 1)
}

// Both doors are gone mid-fight (closed, expired, or cancelled). Pause the
// clock, send the player to door 1's spot to place it again, and remember
// where they stood to bring them back.
function redoor(): void {
  if (!human || !round) return
  const pawn = human.pawn()
  round.returnTo = pawn ? { pos: pawn.position, facing: { pitch: 0, yaw: pawn.eyeAngles.yaw, roll: 0 } } : undefined
  stopWalking()
  round.redoor = true
  round.redoorLeft = Math.max(5, phaseUntil - now())
  round.humanPlaced = false
  round.doorPlacedAt = -1
  round.oldDoors = {}
  round.oldDoorsTaken = false
  round.setupStart = now()
  for (const b of bots()) b.player.freeze(true)
  phase = 'setup'
  phaseUntil = Number.POSITIVE_INFINITY
  showBanner('Doors closed', 'Place door 1 again · the clock is paused', 'accent', 2.5)
}

// ---- Mid-Boss ----

function midbossKidnap(m: MidbossFight, slot: number, jump: number, how: string): void {
  if (!human || !round) return
  kidnapped(m, slot, now(), settings.midboss.respawn)
  round.tracker.log.push(`kidnap ${Math.round(jump)} u via ${how}`)
  showBanner('KIDNAPPED!', `Out for ${settings.midboss.respawn} s`, 'amber', 1.4)
  resetCooldowns(human, effective().cooldowns, true, effective().shortVortex, effective().shortCart)
  const victim = enemies().find((b) => b.player.slot === slot)
  if (victim) {
    release(victim.player)
    // Your team at door 1 finishes them.
    after(1, () => victim.player.kill())
  }
}

// Enemies out of the fight (kidnapped, or killed) come back into the pit once
// their respawn time is up.
function midbossReturn(m: MidbossFight): void {
  if (!round) return
  const t = now()
  for (const b of enemies()) {
    const slot = b.player.slot
    if (!alive(b.player)) {
      if (m.out[slot] === undefined) m.out[slot] = t + settings.midboss.respawn
      round.placed[slot] = false
      continue
    }
    if (m.out[slot] !== undefined) {
      if (t < m.out[slot]) continue
      delete m.out[slot]
      round.placed[slot] = false
    }
    if (!round.placed[slot]) {
      const s = spotFor(b)
      if (!s) continue
      b.player.teleport(s.pos, s.facing)
      b.player.freeze(false)
      refresh(b.player)
      round.placed[slot] = true
      round.tracker.forgetPositions(t)
    }
  }
}

function midbossEnd(m: MidbossFight, won: boolean, why: string): void {
  if (!round) return
  stopWalking()
  closeDoors()
  for (const b of bots()) b.player.freeze(true)
  const points = midbossScore(m, won)
  const best = practiceAids() ? false : recordMidboss(m, won, settings.midboss.difficulty)
  lastMidboss = { won, score: points, kidnaps: m.kidnaps, hp: Math.round(m.hp), best }
  showBanner(best ? `New best: ${points}` : won ? `Mid-Boss held · ${points}` : `${why} · ${points}`, `${m.kidnaps} kidnaps · Mid-Boss at ${Math.round(m.hp)}%${won ? '' : ` · ${why}`}`, won ? 'success' : 'danger', settings.resultSec + 2)
  log(`midboss: ${won ? 'held' : why}, ${m.kidnaps} kidnaps, ${Math.round(m.hp)}% hp, ${points} points${best ? ' (best)' : ''}`)
  endMidboss()
  const outcome: Outcome = won ? 'kidnap' : 'died'
  round.outcome = outcome
  lastOutcome = outcome
  phase = 'result'
  resultStart = now()
  phaseUntil = settings.autoNext ? now() + settings.resultSec + 2 : Number.POSITIVE_INFINITY
}

// ---- endless ----

function endlessKidnap(r: Run, slot: number, jump: number, how: string): void {
  if (!human || !round) return
  const t = now()
  const { points, multi } = scoreKidnap(r, slot, t)
  round.tracker.log.push(`kidnap ${Math.round(jump)} u via ${how}`)
  const left = enemies().length - outCount(r)
  showBanner(multi > 1 ? `MULTI-KIDNAP x${multi}!  +${points}` : `KIDNAPPED!  +${points}`, left > 0 ? `${left} left` : 'Wave clear!', 'amber', 1.6)
  // Reward: Cart, Bell and items come back so you can chain the next one.
  // Doorway is left alone: refreshing it would take the doors down.
  resetCooldowns(human, effective().cooldowns, true, effective().shortVortex, effective().shortCart)
  const victim = enemies().find((b) => b.player.slot === slot)
  if (victim) {
    release(victim.player)
    after(1, () => victim.player.kill())
  }
  if (left <= 0) endlessWaveClear(r)
}

function endlessWaveClear(r: Run): void {
  stopWalking()
  const cleared = r.wave
  const bonus = clearWave(r, timeLeft())
  closeDoors()
  for (const b of bots()) b.player.freeze(true)
  showBanner(`Wave ${cleared} cleared`, `+${bonus} · score ${r.score} · next: wave ${r.wave}, ${waveSeconds(r.wave)} s`, 'success', 2.8)
  round = undefined
  phase = 'result'
  waveBreak = true
  resultStart = now()
  phaseUntil = now() + 2.8
}

function endlessGameOver(r: Run, why: 'died' | 'time'): void {
  stopWalking()
  const best = practiceAids() ? false : recordRun(r)
  lastRunSummary = { wave: r.wave, score: r.score, best, difficulty: r.difficulty }
  endRun()
  closeDoors()
  for (const b of bots()) b.player.freeze(true)
  const title = best ? `New best: ${r.score}` : `Game over · ${r.score}`
  showBanner(title, `${why === 'died' ? 'You died' : 'Time ran out'} on wave ${r.wave}`, best ? 'amber' : 'danger', 6)
  log(`endless over: wave ${r.wave}, score ${r.score}${best ? ' (best)' : ''}`)
  round = undefined
  phase = 'result'
  waveBreak = false
  resultStart = now()
  phaseUntil = Number.POSITIVE_INFINITY
}

// Enemies killed without a kidnap come back to the fight once they respawn.
function endlessReturnDead(r: Run): void {
  if (!round) return
  for (const b of enemies()) {
    const slot = b.player.slot
    if (r.out[slot]) continue
    if (!alive(b.player)) {
      round.placed[slot] = false
      continue
    }
    if (!round.placed[slot]) {
      const s = spotFor(b)
      if (!s) continue
      b.player.teleport(s.pos, s.facing)
      b.player.freeze(false)
      refresh(b.player)
      round.placed[slot] = true
      round.tracker.forgetPositions(now())
    }
  }
}

function finish(outcome: Outcome, quiet = false): void {
  stopWalking()
  waveBreak = false
  endMidboss()
  if (!round) return
  round.outcome = outcome
  if (outcome !== 'skipped') lastOutcome = outcome
  closeDoors()
  for (const b of bots()) b.player.freeze(true)
  const t = round.tracker
  const ok = isSuccess(outcome)
  let unlockedNow = false
  if (outcome !== 'skipped') {
    const door2 = t.firstDoor2At >= 0 ? t.firstDoor2At - t.fightStart : -1
    const cart = t.firstCartAt >= 0 ? t.firstCartAt - t.fightStart : -1
    const loc = selectionKey(round.pick.location)
    recordRound(outcome, loc, `${loc}#${round.pick.fightIndex}`, door2, cart)
    if (round.levelAtStart > 0 && !practiceAids()) {
      const unlocked = recordLevelResult(round.levelAtStart, ok, outcome === 'kidnapKill')
      if (unlocked) {
        unlockedNow = true
        const l = LEVELS[unlocked - 1]
        if (settings.autoAdvance && settings.mode === 'ladder') {
          settings.level = unlocked
          saveSettings()
          showBanner(`Level ${unlocked} · ${l.name}`, `Passed! Moving up: ${l.blurb}`, 'amber', 6)
        } else showBanner(`Level ${unlocked} unlocked`, `${l.name}: ${l.blurb}. Open /dt to switch.`, 'amber', 6)
        if (human) human.announce('Level passed!', `Level ${unlocked} · ${l.name} unlocked`)
      }
    }
  }
  if (!quiet && !unlockedNow) {
    const detail = ok ? `Streak ${stats.streak} · best ${stats.bestStreak}` : OUTCOME_TIPS[outcome]
    showBanner(OUTCOME_TITLES[outcome], detail, ok ? 'success' : outcome === 'skipped' ? 'accent' : 'danger', settings.resultSec + 0.5)
  }
  log(`round: ${outcome} at ${round.pick.location.name} #${round.pick.fightIndex + 1}${t.log.length ? ' · ' + t.log.join(', ') : ''}`)
  phase = 'result'
  resultStart = now()
  if (human) resetCooldowns(human, effective().cooldowns, false, effective().shortVortex, effective().shortCart)
  // With auto-continue off, the result screen waits for Retry / Next.
  phaseUntil = settings.autoNext ? now() + settings.resultSec : Number.POSITIVE_INFINITY
}

// ---- driven bots ----

// Walk levels are always driven. Full-AI bots get the scripted fighter once
// the game's own brain has been seen standing idle.
// In the Mid-Boss mode (`boss` set), a bot takes the boss unless you are
// close to it, then it turns on you.
const PEEL = 1000
function driveBots(t: number, out?: Record<number, boolean>, leash?: number, boss?: Vector): void {
  if (!human) return
  const me = human.pawn()
  if (!me) return
  const eff = effective()
  // With "Game's own", the trainer still steps in if the game's brain idles.
  if (eff.behaviour === 'fight' && settings.botAi === 'game' && !scriptedFight && brainCheckAt > 0 && t >= brainCheckAt) {
    brainCheckAt = -1
    let moved = false
    for (const b of enemies()) {
      const start = fightStartPos[b.player.slot]
      const p = b.player.pawn()
      if (start && p && vector.flatDistance(start, p.position) > 80) moved = true
    }
    if (!moved && enemies().length > 0) {
      scriptedFight = true
      log('bots stood idle: the scripted fighter drives them from now on')
    }
  }
  const trainerFights = settings.botAi === 'trainer' || scriptedFight
  if (eff.behaviour === 'still' || (eff.behaviour === 'fight' && !trainerFights)) return
  if (eff.behaviour === 'fight') observe(me, t)
  const live = enemies().filter((b) => !(out && out[b.player.slot]))
  const positions: Record<number, Vector> = {}
  for (const b of live) {
    const p = b.player.pawn()
    if (p && p.health > 0) positions[b.player.slot] = p.position
  }
  for (const b of live) {
    const s = spotFor(b)
    if (!s) continue
    if (eff.behaviour === 'walk') walk(b.player, s.pos, me.position, t, eff.moves)
    else {
      const others: Vector[] = []
      for (const key of Object.keys(positions)) if (Number(key) !== b.player.slot) others.push(positions[Number(key)])
      const at = positions[b.player.slot]
      if (boss && at && (me.health <= 0 || vector.flatDistance(at, me.position) > PEEL)) hitBoss(b.player, boss, t, eff.difficulty, others)
      else {
        leaveBoss(b.player.slot)
        fight(b.player, s.pos, me, t, eff.difficulty, others, leash)
      }
    }
  }
}

// ---- per-frame ----

function cartPositions(): { id: number; pos: Vector }[] {
  const out: { id: number; pos: Vector }[] = []
  for (const key of Object.keys(cartIds)) {
    const id = Number(key)
    const p = entityPosition(id)
    if (!p) {
      delete cartIds[id]
      continue
    }
    out.push({ id, pos: p.position })
  }
  return out
}

function carriesCart(victimEntity: number, casterEntity: number): boolean {
  for (const m of modifiers(victimEntity)) {
    if (m.caster !== casterEntity) continue
    const id = (m.name + ' ' + m.className).toLowerCase()
    if (!seenModifiers[id]) {
      seenModifiers[id] = true
      dbg(`modifier from you on an enemy: ${m.name} (${m.className})`)
    }
    if (id.indexOf('cart') >= 0) return true
  }
  return false
}

function enemySamples(): EnemySample[] {
  const out: EnemySample[] = []
  const me = human ? human.pawn() : undefined
  for (const b of enemies()) {
    const pawn = b.player.pawn()
    if (!pawn) continue
    out.push({
      slot: b.player.slot,
      pos: pawn.position,
      alive: pawn.health > 0,
      carted: me !== undefined && pawn.health > 0 && carriesCart(pawn.entity, me.entity),
    })
  }
  return out
}

export function frame(): void {
  const t = now()
  fallGuard()
  if (phase === 'idle' || !human) return
  if (phase === 'result') {
    if (waveBreak) {
      if (t < phaseUntil) return
      waveBreak = false
      if (running && currentRun()) beginSetup(false)
      else phase = 'idle'
      return
    }
    if (t >= phaseUntil) {
      const missed = round !== undefined && round.outcome !== undefined && !isSuccess(round.outcome) && round.outcome !== 'skipped'
      round = undefined
      if (running) beginSetup(missed && settings.afterMiss === 'retry')
      else phase = 'idle'
    }
    return
  }
  if (!round) {
    phase = 'idle'
    return
  }
  const tr = round.tracker
  if (phase === 'setup') {
    placeHuman()
    if (!round.humanPlaced) {
      // Dead, respawning or being rebuilt: hold the setup clock until the
      // player stands at the anchor. Never start a fight without them.
      if (!alive(human) && !round.humanBuilding && t - round.lastRespawnTry > 3) {
        round.lastRespawnTry = t
        human.respawn()
      }
      return
    }
    const ready = placeBots()
    // Doors closed at setup start can linger a few frames: count after that.
    // A door entity showing up also counts as door 1, in case the cast event
    // doesn't fire for it.
    if (t > round.setupStart + 0.5) {
      // Doors from the last try can linger: only a door that appeared after
      // setup began counts as door 1.
      const doors = doorEntities()
      if (!round.oldDoorsTaken) {
        round.oldDoorsTaken = true
        for (const d of doors) round.oldDoors[d] = true
      }
      const fresh = doors.filter((d) => !round!.oldDoors[d]).length
      tr.doorCount(fresh, false)
      if (fresh > 0 && round.doorPlacedAt < 0) round.doorPlacedAt = t
    }
    // Go the moment door 1 is down (a short beat lets the door finish
    // spawning). Bots still spawning get up to 3 s more.
    const doorDone = round.doorPlacedAt >= 0 && t >= round.doorPlacedAt + 0.25
    if (doorDone && (ready || t > round.doorPlacedAt + 3)) beginFight()
    return
  }
  if (phase === 'fight' && midbossFight()) {
    const m = midbossFight() as MidbossFight
    const doors = doorPositions()
    tr.doorCount(doors.length, true)
    if (doors.length > 0) round.doorsSeenAt = t
    else if (settings.redoor && t - round.doorsSeenAt > 1) return redoor()
    tr.carts(t, cartPositions())
    midbossReturn(m)
    const outSet: Record<number, boolean> = {}
    for (const key of Object.keys(m.out)) outSet[Number(key)] = true
    const pit = (round.pick.location.pit ?? round.pick.location.fights[0]).pos
    const boss = realBoss ? bossState() : undefined
    driveBots(t, outSet, 550, boss ? boss.position : undefined)
    for (const det of tr.frameAll(t, enemySamples().filter((s) => m.out[s.slot] === undefined), doors)) midbossKidnap(m, det.victim, det.jump, det.how)
    // The Mid-Boss drains for every enemy standing in the pit, on top of the
    // real hits it takes.
    pitCount = 0
    for (const b of enemies()) {
      if (m.out[b.player.slot] !== undefined) continue
      const p = b.player.pawn()
      if (p && p.health > 0 && vector.flatDistance(p.position, pit) < PIT_RADIUS && Math.abs(p.position.z - pit.z) < PIT_HEIGHT) pitCount++
    }
    const delta = drain(m, t, pitCount, settings.midboss.difficulty)
    if (realBoss) {
      if (!boss) {
        m.hp = 0 // killed outright
      } else {
        m.hp = Math.max(0, (boss.health / Math.max(1, boss.maxHealth)) * 100 - delta)
        if (m.hp <= 1) {
          m.hp = 0
          removeBoss() // taken out before it dies: no Rejuvenator for the bots
        } else if (delta > 0) setBossPercent(m.hp)
      }
    }
    if (m.hp <= 0) return midbossEnd(m, false, 'Enemies took the Mid-Boss')
    if (!alive(human)) return midbossEnd(m, false, 'You died')
    if (t >= phaseUntil) return midbossEnd(m, true, 'Mid-Boss held')
    return
  }
  if (phase === 'fight' && endlessRun()) {
    const r = endlessRun() as Run
    const doors = doorPositions()
    tr.doorCount(doors.length, true)
    if (doors.length > 0) round.doorsSeenAt = t
    // No door for a second, enemies still in: re-place door 1 for this wave.
    else if (settings.redoor && t - round.doorsSeenAt > 1 && outCount(r) < enemies().length) return redoor()
    tr.carts(t, cartPositions())
    endlessReturnDead(r)
    driveBots(t, r.out)
    for (const det of tr.frameAll(t, enemySamples().filter((s) => !r.out[s.slot]), doors)) {
      endlessKidnap(r, det.victim, det.jump, det.how)
      if (phase !== 'fight') return // the wave cleared
    }
    if (enemies().length === 0) return // roster still spawning
    if (!alive(human)) return endlessGameOver(r, 'died')
    if (t >= phaseUntil) return endlessGameOver(r, 'time')
    return
  }
  if (phase === 'fight') {
    const doors = doorPositions()
    tr.doorCount(doors.length, true)
    if (doors.length > 0) round.doorsSeenAt = t
    else if (settings.redoor && t - round.doorsSeenAt > 1) return redoor()
    tr.carts(t, cartPositions())
    driveBots(t)
    const det = tr.frame(t, enemySamples(), doors)
    if (det) {
      round.victim = det.victim
      tr.log.push(`kidnap ${Math.round(det.jump)} u via ${det.how}`)
      dbg(`KIDNAP slot ${det.victim}: jump ${Math.round(det.jump)} u, ${det.how}`)
      if (settings.followSec <= 0) return finish('kidnap')
      // Counted already; the fight runs on a moment so you can watch where
      // they went, or follow them through the door.
      phase = 'follow'
      phaseUntil = t + settings.followSec
      showBanner('KIDNAPPED!', 'Through the door', 'amber', settings.followSec + 0.3)
      return
    }
    if (!alive(human)) return finish('died')
    if (t >= phaseUntil) return finish(tr.missReason())
    return
  }
  if (phase === 'follow') {
    driveBots(t)
    if (t >= phaseUntil) return finish('kidnap')
  }
}

// ---- events ----

function isHuman(p: Player | undefined): boolean {
  return human !== undefined && p !== undefined && p.slot === human.slot
}

export function onCast(cast: AbilityCastEvent): void {
  if (!isHuman(cast.player)) return
  const n = cast.name.toLowerCase()
  dbg(`cast ${cast.name} slot ${cast.slot} in ${phase}`)
  if (!round) return
  const fighting = phase === 'fight' || phase === 'follow'
  if (n.indexOf('doorway') >= 0 && n.indexOf('close') < 0 && n.indexOf('trigger') < 0) {
    round.tracker.doorCast(now(), fighting)
    if (phase === 'setup' && round.doorPlacedAt < 0) round.doorPlacedAt = now()
  } else if (n.indexOf('cart') >= 0) {
    if (fighting) round.tracker.cartCast(now())
  } else if (n.indexOf('hotel') >= 0) {
    round.tracker.hotelCast(now())
  }
}

export function onProjectile(p: LaunchEvent): void {
  if (!isHuman(p.player)) return
  if (p.name.toLowerCase().indexOf('cart') < 0) return
  cartIds[p.entity] = true
  dbg(`cart projectile ${p.name} launched`)
}

export function onKillEvent(kill: KillEvent): void {
  if (!round) return
  if (phase === 'follow' && kill.victimPlayer && kill.victimPlayer.slot === round.victim) round.victimDied = true
  if (phase === 'fight' && isHuman(kill.victimPlayer)) {
    const r = endlessRun()
    const m = midbossFight()
    if (r) endlessGameOver(r, 'died')
    else if (m) midbossEnd(m, false, 'You died')
    else finish('died')
  }
}

// For /debug and the HUD: how far the current fight spot is from its anchor.
// /badspot: hide the current fight spot for good and move on to the next.
export function hideCurrentSpot(): string | undefined {
  const pick = round ? round.pick : lastPlan ? lastPlan.pick : undefined
  if (!pick) return undefined
  const key = spotKey(pick.location, pick.fightIndex)
  if (settings.hiddenSpots.indexOf(key) < 0) settings.hiddenSpots.push(key)
  saveSettings()
  clearPlan()
  const name = `${pick.location.name} spot ${pick.fightIndex + 1}`
  log(`hidden spot ${key} (${name})`)
  if (phase === 'setup' || phase === 'fight' || phase === 'follow' || phase === 'result') next()
  return name
}

export function describeRound(): string {
  if (!round) return ''
  const l = round.pick.location
  return `${l.name} · spot ${round.pick.fightIndex + 1}/${l.fights.length}`
}
