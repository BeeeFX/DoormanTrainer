import { Buttons, Layers, trace, vector, type Angles, type DriveCommand, type Pawn, type Player, type Vector } from 'modlock'
import { rand } from './util'

// Bots the mod drives itself. The game's bot brain sits idle in this setup
// (no lanes to push), so moving targets and, when needed, fighting bots are
// steered here. Driving takes the controls only; the Luggage Cart still
// drags them.
//
// Walk: strafe around a home spot while facing the player, picking a new
// direction every second or two, like a target dodging. With moves on, some
// direction changes come with a jump, a dash or a slide (a dash with crouch
// held).
// Fight: a small tactical brain (see fight() below): keeps a fighting range,
// strafes across the player's aim, dodges, tracks with human-like aim, uses
// abilities in range, retreats when hurt, and spreads out from other bots.

export interface Moves {
  jump: boolean
  slide: boolean
  dash: boolean
}
export const NO_MOVES: Moves = { jump: false, slide: false, dash: false }

interface Walk {
  target: Vector
  until: number
  crouchUntil: number // holding crouch for a slide
  press: bigint // a tap to send with the next command
}

interface Fight {
  last: number // time of the last tick, for turn speed
  aim: Angles // where the bot is looking now
  wobble: { pitch: number; yaw: number } // slow aim drift
  strafeSign: number // +1 left, -1 right across the line to the player
  strafeUntil: number
  burstUntil: number
  pauseUntil: number
  nextAbility: number
  nextUltimate: number
  nextMelee: number
  retreatUntil: number
  retreatedAt: number
  dodgeUntil: number
  press: bigint
  crouchUntil: number
  los: boolean
  losAt: number
  diveUntil: number // rushing in for melee and abilities
  nextDive: number
  diveAbility: boolean // the dive's ability is still to come
  meleeHoldUntil: number // holding melee for a heavy hit
}

const walks: Record<number, Walk> = {}
const fights: Record<number, Fight> = {}
const driven: Record<number, Player> = {}

const RADIUS_MIN = 120
const RADIUS_MAX = 420
const MOVE_CHANCE = 0.65 // of a direction change coming with a move
const SLIDE_SECONDS = 0.7
const ABILITY_KEYS = [Buttons.ability1, Buttons.ability2, Buttons.ability3]

function pickMove(moves: Moves): 'jump' | 'slide' | 'dash' | undefined {
  const on: ('jump' | 'slide' | 'dash')[] = []
  if (moves.jump) on.push('jump')
  if (moves.slide) on.push('slide')
  if (moves.dash) on.push('dash')
  if (on.length === 0 || Math.random() > MOVE_CHANCE) return undefined
  return on[Math.floor(Math.random() * on.length)]
}

// The strafing command for one tick: move toward the current waypoint around
// `home` while looking along `facing`.
function strafe(player: Player, pos: Vector, home: Vector, facing: Angles, now: number, moves: Moves): DriveCommand {
  let w = walks[player.slot]
  if (!w || now > w.until || vector.flatDistance(pos, w.target) < 60) {
    // Moves carry a bot further, so their waypoints reach a bit further out.
    const move = pickMove(moves)
    const reach = move === 'dash' || move === 'slide' ? 1.4 : 1
    const dir = vector.forward({ pitch: 0, yaw: rand(0, 360), roll: 0 })
    w = {
      target: vector.add(home, vector.scale(dir, rand(RADIUS_MIN, RADIUS_MAX) * reach)),
      until: now + rand(1.0, 2.4),
      crouchUntil: move === 'slide' ? now + SLIDE_SECONDS : 0,
      press: move === 'jump' ? Buttons.jump : move === 'dash' || move === 'slide' ? Buttons.dash : 0n,
    }
    walks[player.slot] = w
  }
  const tx = w.target.x - pos.x
  const ty = w.target.y - pos.y
  const len = Math.hypot(tx, ty)
  const dx = len > 1 ? tx / len : 0
  const dy = len > 1 ? ty / len : 0
  const r = (facing.yaw * Math.PI) / 180
  const cmd: DriveCommand = {
    facing,
    forward: dx * Math.cos(r) + dy * Math.sin(r),
    left: -dx * Math.sin(r) + dy * Math.cos(r),
    held: now < w.crouchUntil ? Buttons.crouch : 0n,
    pressed: w.press,
  }
  w.press = 0n // a tap counts once
  return cmd
}

// Moving target: strafes around `home`, facing `face`.
export function walk(player: Player, home: Vector, face: Vector, now: number, moves: Moves): void {
  const pawn = player.pawn()
  if (!pawn || pawn.health <= 0) return
  const facing = vector.level(vector.yawToward(pawn.position, face))
  player.drive(strafe(player, pawn.position, home, facing, now, moves))
  driven[player.slot] = player
}

export function movesFor(difficulty: number): Moves {
  if (difficulty >= 3) return { jump: true, slide: true, dash: true }
  if (difficulty === 2) return { jump: true, slide: false, dash: false }
  return NO_MOVES
}

// ---- the fighter ----

// Per difficulty (index 1-3).
export const SKILL = {
  range: [0, 650, 750, 850], // preferred fighting distance
  band: [0, 250, 200, 160], // how far off the range is fine
  reaction: [0, 0.35, 0.22, 0.12], // s: aims at where the player was this long ago
  turn: [0, 200, 330, 520], // degrees per second
  wobble: [0, 3.5, 2, 1], // degrees of slow aim drift
  fireError: [0, 7, 5, 3.5], // degrees off target still worth shooting
  strafe: [0, [1.4, 2.6], [0.8, 1.8], [0.5, 1.2]] as unknown as number[][], // s between direction flips
  ability: [0, 7, 5, 3.5], // s between abilities
  dodge: [0, 0, 0.5, 0.8], // chance of a jump/dash when the player aims at it
  lead: [0, 0, 0.05, 0.12], // s of the player's movement it leads
  retreat: [0, 0, 0.3, 0.3], // health fraction that sends it back for a moment
  dive: [0, [10, 16], [7, 12], [5, 9]] as unknown as number[][], // s between dives
  heavy: [0, 0, 0.2, 0.4], // chance a melee in a dive is a heavy one
}

const LEASH = 1600 // max distance from the bot's spot before it heads back
const SPREAD = 260 // bots closer than this push apart

// Turns `from` toward `to` by at most `maxDeg`, the short way round.
export function turnToward(from: Angles, to: Angles, maxDeg: number): Angles {
  let dy = ((to.yaw - from.yaw + 540) % 360) - 180
  let dp = to.pitch - from.pitch
  const len = Math.hypot(dy, dp)
  if (len > maxDeg && len > 0) {
    dy = (dy / len) * maxDeg
    dp = (dp / len) * maxDeg
  }
  return { pitch: from.pitch + dp, yaw: from.yaw + dy, roll: 0 }
}

// Angle in degrees between two views.
export function angleBetween(a: Angles, b: Angles): number {
  const dy = ((b.yaw - a.yaw + 540) % 360) - 180
  return Math.hypot(dy, b.pitch - a.pitch)
}

// The fight movement wish, as a flat world vector (length up to 1): keep the
// range, strafe across the line to the player, retreat when hurt, spread out,
// and stay on the leash.
export function fightMove(pos: Vector, target: Vector, home: Vector, others: readonly Vector[], difficulty: number, strafeSign: number, retreating: boolean, dodging: boolean, diving = false, leash = LEASH): { x: number; y: number } {
  const dx = target.x - pos.x
  const dy = target.y - pos.y
  const dist = Math.hypot(dx, dy) || 1
  const to = { x: dx / dist, y: dy / dist }
  const side = { x: -to.y * strafeSign, y: to.x * strafeSign }
  // A dive closes to melee range and mostly runs straight in.
  const range = diving ? 110 : SKILL.range[difficulty]
  const band = diving ? 40 : SKILL.band[difficulty]
  let radial = 0
  if (retreating) radial = -1
  else if (dist > range + band) radial = Math.min(1, (dist - range) / 400)
  else if (dist < range - band) radial = -Math.min(1, (range - dist) / 300)
  const lateral = diving ? 0.35 : dodging ? 1 : 0.8
  let x = to.x * radial + side.x * lateral
  let y = to.y * radial + side.y * lateral
  for (const o of others) {
    const ox = pos.x - o.x
    const oy = pos.y - o.y
    const d = Math.hypot(ox, oy)
    if (d > 1 && d < SPREAD) {
      x += (ox / d) * (1 - d / SPREAD) * 1.2
      y += (oy / d) * (1 - d / SPREAD) * 1.2
    }
  }
  const hx = home.x - pos.x
  const hy = home.y - pos.y
  const away = Math.hypot(hx, hy)
  if (away > leash) {
    x += (hx / away) * 1.5
    y += (hy / away) * 1.5
  }
  const len = Math.hypot(x, y)
  return len > 1 ? { x: x / len, y: y / len } : { x, y }
}

// Where the player was `delay` seconds ago: bots react, they don't read minds.
interface Seen {
  t: number
  eye: Vector
  vel: Vector
}
const seen: Seen[] = []

export function observe(target: Pawn, now: number): void {
  seen.push({ t: now, eye: target.eyePosition, vel: target.velocity })
  while (seen.length > 2 && seen[1].t < now - 0.6) seen.shift()
}

function seenAt(t: number): Seen | undefined {
  let best: Seen | undefined
  for (const s of seen) if (s.t <= t) best = s
  return best ?? seen[0]
}

// One tick of the fighter for one bot. `target` is the player's pawn,
// `others` the other enemy bots' positions.
// `leash` keeps the bot near `home` (the Mid-Boss mode keeps them in the pit).
export function fight(player: Player, home: Vector, target: Pawn, now: number, difficulty: number, others: readonly Vector[], leash = LEASH): void {
  const pawn = player.pawn()
  if (!pawn || pawn.health <= 0) return
  const d = Math.max(1, Math.min(3, Math.round(difficulty)))
  let f = fights[player.slot]
  if (!f) {
    f = {
      last: now,
      aim: vector.aimAt(pawn.eyePosition, target.eyePosition),
      wobble: { pitch: 0, yaw: 0 },
      strafeSign: Math.random() < 0.5 ? 1 : -1,
      strafeUntil: now + rand(0.5, 1.5),
      burstUntil: 0,
      pauseUntil: now + rand(0.2, 0.8),
      nextAbility: now + rand(1.5, 4),
      nextUltimate: now + rand(15, 30),
      nextMelee: now,
      retreatUntil: 0,
      retreatedAt: -100,
      dodgeUntil: 0,
      press: 0n,
      crouchUntil: 0,
      los: true,
      losAt: -1,
      diveUntil: 0,
      nextDive: now + rand(SKILL.dive[d][0], SKILL.dive[d][1]) * 0.5,
      diveAbility: false,
      meleeHoldUntil: 0,
    }
    fights[player.slot] = f
  }
  const dt = Math.max(0, Math.min(0.1, now - f.last))
  f.last = now
  const pos = pawn.position
  const dist = vector.flatDistance(pos, target.position)

  // Line of sight, checked a few times a second.
  if (now - f.losAt > 0.15) {
    f.losAt = now
    f.los = !trace({ start: pawn.eyePosition, end: target.eyePosition, layers: Layers.solid })
  }

  // Retreat for a moment when hurt (once in a while, not forever).
  const hurt = pawn.maxHealth > 0 && pawn.health / pawn.maxHealth < SKILL.retreat[d]
  if (hurt && now > f.retreatUntil && now - f.retreatedAt > 8) {
    f.retreatUntil = now + rand(2, 3.5)
    f.retreatedAt = now
  }
  const retreating = now < f.retreatUntil

  // Dive: every so often, rush in for melee and an ability, then back out.
  if (!retreating && f.los && now >= f.nextDive && now >= f.diveUntil) {
    f.diveUntil = now + rand(1.8, 3.2)
    f.nextDive = f.diveUntil + rand(SKILL.dive[d][0], SKILL.dive[d][1])
    f.diveAbility = true
  }
  const diving = !retreating && now < f.diveUntil

  // Aim: at where the player was a moment ago (plus a lead on harder bots),
  // turned toward at a limited speed, with a slow wobble.
  const s = seenAt(now - SKILL.reaction[d]) ?? { t: now, eye: target.eyePosition, vel: target.velocity }
  const lead = SKILL.lead[d]
  const aimAt = { x: s.eye.x + s.vel.x * lead, y: s.eye.y + s.vel.y * lead, z: s.eye.z - 12 }
  const want = vector.aimAt(pawn.eyePosition, aimAt)
  const wob = SKILL.wobble[d]
  f.wobble = {
    pitch: Math.max(-wob, Math.min(wob, f.wobble.pitch + rand(-1, 1) * wob * dt * 4)),
    yaw: Math.max(-wob, Math.min(wob, f.wobble.yaw + rand(-1, 1) * wob * dt * 4)),
  }
  f.aim = turnToward(f.aim, { pitch: want.pitch + f.wobble.pitch, yaw: want.yaw + f.wobble.yaw, roll: 0 }, SKILL.turn[d] * dt)
  const onTarget = angleBetween(f.aim, want) < SKILL.fireError[d]

  // Is the player aiming at this bot? Then dodge.
  const playerToBot = vector.aimAt(target.eyePosition, pawn.eyePosition)
  const aimedAt = angleBetween(target.eyeAngles, playerToBot) < 6
  if (aimedAt && now > f.dodgeUntil) {
    f.dodgeUntil = now + rand(0.6, 1.1)
    f.strafeSign = -f.strafeSign
    f.strafeUntil = now + rand(0.4, 0.9)
    if (Math.random() < SKILL.dodge[d]) {
      const r = Math.random()
      if (d >= 3 && r < 0.35) {
        f.press = f.press | Buttons.dash
        f.crouchUntil = now + 0.6 // dash + crouch = slide
      } else if (d >= 3 && r < 0.6) f.press = f.press | Buttons.dash
      else f.press = f.press | Buttons.jump
    }
  }
  if (now > f.strafeUntil) {
    f.strafeSign = -f.strafeSign
    const [lo, hi] = SKILL.strafe[d]
    f.strafeUntil = now + rand(lo, hi)
  }

  const move = fightMove(pos, target.position, home, others, d, f.strafeSign, retreating, now < f.dodgeUntil, diving, leash)
  const r = (f.aim.yaw * Math.PI) / 180
  let held = now < f.crouchUntil ? Buttons.crouch : 0n
  let pressed = f.press
  f.press = 0n

  // Shoot in bursts when the player is in sight and roughly on target.
  if (now >= f.pauseUntil && now >= f.burstUntil) {
    f.burstUntil = now + rand(0.6, 1.4) + 0.2 * d
    f.pauseUntil = f.burstUntil + rand(0.25, 0.8) * (4 - d) * 0.5
  }
  if (!retreating && f.los && onTarget && now < f.burstUntil && now >= f.meleeHoldUntil) held = held | Buttons.attack

  // Abilities in range and in sight, aimed; the ultimate now and then on Hard.
  if (!retreating && f.los && onTarget && dist < 1300 && now >= f.nextAbility) {
    pressed = pressed | ABILITY_KEYS[Math.floor(Math.random() * ABILITY_KEYS.length)]
    f.nextAbility = now + SKILL.ability[d] * rand(0.7, 1.3)
  }
  if (d >= 3 && !retreating && f.los && onTarget && dist < 1000 && now >= f.nextUltimate) {
    pressed = pressed | Buttons.ultimate
    f.nextUltimate = now + rand(20, 35)
  }
  // Diving in: the dive's ability goes off once the bot is close.
  if (diving && f.diveAbility && f.los && dist < 450) {
    pressed = pressed | ABILITY_KEYS[Math.floor(Math.random() * ABILITY_KEYS.length)]
    f.diveAbility = false
  }
  // Melee when the player is right on top of it; in a dive, sometimes heavy
  // (the melee key held for a moment).
  if (dist < 180 && now >= f.nextMelee) {
    if (diving && Math.random() < SKILL.heavy[d]) f.meleeHoldUntil = now + 0.7
    else pressed = pressed | Buttons.melee
    f.nextMelee = now + rand(0.7, 1.2)
  }
  if (now < f.meleeHoldUntil) held = held | Buttons.melee

  player.drive({
    facing: f.aim,
    forward: move.x * Math.cos(r) + move.y * Math.sin(r),
    left: -move.x * Math.sin(r) + move.y * Math.cos(r),
    held,
    pressed,
  })
  driven[player.slot] = player
}

// Mid-Boss mode: a bot taking the boss circles it at close range and shoots
// its body, using abilities on it now and then, as a team on the boss does.
interface BossHit {
  last: number
  aim: Angles
  strafeSign: number
  strafeUntil: number
  nextAbility: number
}
const bossHits: Record<number, BossHit> = {}

export function hitBoss(player: Player, boss: Vector, now: number, difficulty: number, others: readonly Vector[]): void {
  const pawn = player.pawn()
  if (!pawn || pawn.health <= 0) return
  const d = Math.max(1, Math.min(3, Math.round(difficulty)))
  const body = { x: boss.x, y: boss.y, z: boss.z + 110 }
  const want = vector.aimAt(pawn.eyePosition, body)
  let h = bossHits[player.slot]
  if (!h) {
    // Turning from wherever the fighter was aiming, if it was.
    const f = fights[player.slot]
    h = { last: now, aim: f ? f.aim : pawn.eyeAngles, strafeSign: Math.random() < 0.5 ? 1 : -1, strafeUntil: now + rand(1, 2.5), nextAbility: now + rand(1, 3) }
    bossHits[player.slot] = h
  }
  const dt = Math.max(0, Math.min(0.1, now - h.last))
  h.last = now
  if (now >= h.strafeUntil) {
    h.strafeSign = -h.strafeSign
    h.strafeUntil = now + rand(1, 2.5)
  }
  h.aim = turnToward(h.aim, want, SKILL.turn[d] * dt)
  if (fights[player.slot]) fights[player.slot].aim = h.aim
  // Hold 350-650 units from the boss, strafing around it, apart from the others.
  const move = fightMove(pawn.position, boss, boss, others, d, h.strafeSign, false, false, false, 700)
  const dist = vector.flatDistance(pawn.position, boss)
  const mx = dist < 350 ? -1 : dist > 650 ? 1 : 0
  const dx = (boss.x - pawn.position.x) / Math.max(1, dist)
  const dy = (boss.y - pawn.position.y) / Math.max(1, dist)
  const x = move.x * 0.6 + dx * mx * 0.8
  const y = move.y * 0.6 + dy * mx * 0.8
  const r = (h.aim.yaw * Math.PI) / 180
  let held = 0n
  let pressed = 0n
  if (angleBetween(h.aim, want) < 8) held = Buttons.attack
  if (dist < 900 && now >= h.nextAbility) {
    pressed = ABILITY_KEYS[Math.floor(Math.random() * ABILITY_KEYS.length)]
    h.nextAbility = now + SKILL.ability[d] * rand(1, 1.6)
  }
  player.drive({ facing: h.aim, forward: x * Math.cos(r) + y * Math.sin(r), left: -x * Math.sin(r) + y * Math.cos(r), held, pressed })
  driven[player.slot] = player
}

// The bot turns back to the player: its boss state is dropped.
export function leaveBoss(slot: number): void {
  delete bossHits[slot]
}

// Hands one bot back to its own brain (a kidnapped one, say).
export function release(player: Player): void {
  const slot = player.slot
  if (driven[slot]) player.drive()
  delete driven[slot]
  delete walks[slot]
  delete fights[slot]
  delete bossHits[slot]
}

// Hands every driven bot back to its own brain.
export function stopWalking(): void {
  for (const key of Object.keys(driven)) {
    const slot = Number(key)
    driven[slot].drive()
    delete driven[slot]
    delete walks[slot]
    delete fights[slot]
    delete bossHits[slot]
  }
}
