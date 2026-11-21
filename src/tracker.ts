import { vector, type Vector } from 'modlock'

// What a round ended with. Everything but kidnap / kidnapKill is a miss, and
// says which step of the combo broke.
export type Outcome = 'kidnapKill' | 'kidnap' | 'died' | 'noFirstDoor' | 'noSecondDoor' | 'noCart' | 'cartMissed' | 'missedDoor' | 'skipped'

export const OUTCOME_TITLES: Record<Outcome, string> = {
  kidnapKill: 'Kidnap kill',
  kidnap: 'Kidnapped!',
  died: 'You died',
  noFirstDoor: 'No first door placed',
  noSecondDoor: 'No second door placed',
  noCart: 'Cart never thrown',
  cartMissed: 'Cart missed',
  missedDoor: 'Dragged, but missed the door',
  skipped: 'Skipped',
}

export const OUTCOME_TIPS: Record<Outcome, string> = {
  kidnapKill: 'Clean. Do it again.',
  kidnap: 'Through the door. Again!',
  died: 'Place door 2 from cover and cart from the edge of the fight.',
  noFirstDoor: 'Cast Doorway (2) as soon as you land at the tower.',
  noSecondDoor: 'Door 2 goes between you and the enemies, before you cart.',
  noCart: 'Cart (3) right after door 2: the door closes in 15 s.',
  cartMissed: 'Aim the cart at a group, not a single moving target.',
  missedDoor: 'Line it up: enemy, door, you. Stand so the cart path crosses the door.',
  skipped: '',
}

export function isSuccess(o: Outcome): boolean {
  return o === 'kidnap' || o === 'kidnapKill'
}

export interface EnemySample {
  slot: number
  pos: Vector
  alive: boolean
  carted: boolean // carries the human's cart modifier this frame
}

export interface TrackerConfig {
  mode: 'track' | 'radius'
  jumpUnits: number
  cartWindowSec: number
  kidnapRadius: number
}

// Once the cart's modifier has been seen on an enemy this session, the game is
// known to report it: from then on the bare cart-window path is not enough.
let cartModifierKnown = false
export function cartModifierSeen(): boolean {
  return cartModifierKnown
}
export function resetCartModifierKnown(): void {
  cartModifierKnown = false
}

export interface Detection {
  victim: number
  jump: number
  how: string
}

// Watches one round. Pure logic: the round feeds it events and samples.
export class Tracker {
  cfg: TrackerConfig
  anchor: Vector
  // Setup phase.
  doorCastsSetup = 0
  maxDoorsSetup = 0
  // Fight phase.
  doorCastsFight = 0
  maxDoorsFight = 0
  cartCasts = 0
  cartUntil = -1
  hotelUntil = -1
  everCarted = false
  graceUntil = 0
  fightStart = 0
  cartedAt: Record<number, number> = {}
  prev: Record<number, Vector> = {}
  cartPrev: Record<number, Vector> = {}
  lastCartJump = -100
  maxJump = 0
  firstDoor2At = -1
  firstCartAt = -1
  log: string[] = []

  constructor(cfg: TrackerConfig, anchor: Vector) {
    this.cfg = cfg
    this.anchor = anchor
  }

  startFight(now: number): void {
    this.fightStart = now
    this.graceUntil = now + 0.5
    this.prev = {}
  }

  // Positions jump when the mod teleports: forget them.
  forgetPositions(now: number): void {
    this.prev = {}
    this.graceUntil = Math.max(this.graceUntil, now + 0.3)
  }

  doorCast(now: number, fighting: boolean): void {
    if (fighting) {
      this.doorCastsFight++
      if (this.firstDoor2At < 0) this.firstDoor2At = now
    } else this.doorCastsSetup++
  }

  doorCount(count: number, fighting: boolean): void {
    if (fighting) this.maxDoorsFight = Math.max(this.maxDoorsFight, count)
    else this.maxDoorsSetup = Math.max(this.maxDoorsSetup, count)
  }

  cartCast(now: number): void {
    this.cartCasts++
    this.cartUntil = now + this.cfg.cartWindowSec
    if (this.firstCartAt < 0) this.firstCartAt = now
  }

  hotelCast(now: number): void {
    this.hotelUntil = now + 6
  }

  // Cart projectile positions this frame. A cart that jumps went through a door.
  carts(now: number, list: { id: number; pos: Vector }[]): void {
    const next: Record<number, Vector> = {}
    for (const c of list) {
      const p = this.cartPrev[c.id]
      if (p && vector.distance(p, c.pos) > this.cfg.jumpUnits) {
        this.lastCartJump = now
        this.log.push(`cart jumped ${Math.round(vector.distance(p, c.pos))} u`)
      }
      next[c.id] = c.pos
    }
    this.cartPrev = next
  }

  // Returns a detection the first frame an enemy is kidnapped.
  // `doors` are the open doors' positions; with two of them, an enemy that
  // jumps and lands at one while the cart is in play has gone through.
  frame(now: number, enemies: EnemySample[], doors?: Vector[]): Detection | undefined {
    return this.frameAll(now, enemies, doors)[0]
  }

  // Every enemy that went through this frame (one cart can carry several).
  frameAll(now: number, enemies: EnemySample[], doors?: Vector[]): Detection[] {
    const all: Detection[] = []
    for (const e of enemies) {
      if (!e.alive) {
        delete this.prev[e.slot]
        continue
      }
      if (e.carted) {
        this.cartedAt[e.slot] = now
        this.everCarted = true
        cartModifierKnown = true
      }
      const prev = this.prev[e.slot]
      this.prev[e.slot] = e.pos
      if (!prev || now < this.graceUntil) continue
      if (now < this.hotelUntil) continue
      const jump = vector.distance(prev, e.pos)
      if (jump > this.maxJump) this.maxJump = jump
      const before = vector.distance(prev, this.anchor)
      const after = vector.distance(e.pos, this.anchor)
      const carted = this.cartedAt[e.slot] !== undefined && now - this.cartedAt[e.slot] < 1.0
      const cartJumped = now - this.lastCartJump < 1.0
      // The cart window alone (no modifier, no cart jump) only counts while
      // the game has not shown it reports the cart modifier.
      const inWindow = now < this.cartUntil && (carted || cartJumped || !cartModifierKnown)
      if (this.cfg.mode === 'radius') {
        // Fallback for door transits that aren't one-frame teleports: entering
        // the radius still needs a fast approach, far beyond walking speed.
        if ((inWindow || carted) && after < this.cfg.kidnapRadius && before >= this.cfg.kidnapRadius && before - after > 250) {
          all.push({ victim: e.slot, jump, how: 'radius' })
        }
        continue
      }
      // Through the door: a big one-frame jump that lands at one of the doors.
      if (doors && doors.length >= 2 && jump > 400 && (carted || cartJumped || inWindow)) {
        let atDoor = false
        for (const d of doors) if (vector.flatDistance(e.pos, d) < 320) atDoor = true
        if (atDoor) {
          const how = ['door', carted ? 'carted' : '', cartJumped ? 'cart-jump' : ''].filter((s) => s).join('+')
          all.push({ victim: e.slot, jump, how })
          continue
        }
      }
      // Older rule, for when door positions aren't known: a jump toward door 1's spot.
      if (jump > this.cfg.jumpUnits && after < before - 300 && (carted || inWindow)) {
        const how = [carted ? 'carted' : 'window', cartJumped ? 'cart-jump' : ''].filter((s) => s).join('+')
        all.push({ victim: e.slot, jump, how })
      }
    }
    return all
  }

  // Why the round failed, from the steps that happened.
  missReason(): Outcome {
    if (this.doorCastsSetup === 0 && this.maxDoorsSetup === 0) return 'noFirstDoor'
    if (this.doorCastsFight === 0 && this.maxDoorsFight < 2) return 'noSecondDoor'
    if (this.cartCasts === 0) return 'noCart'
    if (!this.everCarted) return 'cartMissed'
    return 'missedDoor'
  }
}
