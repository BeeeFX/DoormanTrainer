// Pure-logic tests: kidnap detection and the ladder's pass rules.
// Run with: npm test
import { resetCartModifierKnown, Tracker, type EnemySample } from '../src/tracker'
import { beginWave, bestFor, clearWave, outCount, recordRun, scoreKidnap, startRun, waveDifficulty, waveEnemies, waveSeconds } from '../src/endless'
import { plannedTiers } from '../src/build'
import { drain, kidnapped, score as midbossScore, startFight as startMidboss } from '../src/midboss'
import { angleBetween, fightMove, turnToward } from '../src/walker'
import { LEVELS, levelProgress, passProgress, recordLevelResult, unlockedLevel, resetProgress } from '../src/levels'

let failed = 0
let passed = 0
function check(name: string, cond: boolean): void {
  if (cond) passed++
  else {
    failed++
    console.log(`FAIL ${name}`)
  }
}

const anchor = { x: 0, y: 0, z: 0 }
const cfg = { mode: 'track' as const, jumpUnits: 600, cartWindowSec: 3, kidnapRadius: 1500 }
const at = (x: number): EnemySample['pos'] => ({ x, y: 0, z: 0 })
const enemy = (x: number, carted = false, alive = true): EnemySample => ({ slot: 5, pos: at(x), alive, carted })

// A fight from t = 10: the enemy stands 2500 u from the anchor.
function fight(): Tracker {
  const t = new Tracker(cfg, anchor)
  t.startFight(10)
  t.frame(10.6, [enemy(2500)])
  return t
}

{
  // Carted through the door: one-frame jump to the anchor.
  const t = fight()
  t.cartCast(11)
  t.frame(11.1, [enemy(2400, true)])
  const d = t.frame(11.2, [enemy(150, true)])
  check('kidnap detected on door jump while carted', d !== undefined && d.victim === 5)
}
{
  // Doors anywhere: landing at a door while the cart is in play counts, even
  // moving away from door 1's spot.
  const t = fight()
  t.cartCast(11)
  const doors = [at(5000), at(2600)]
  t.frame(11.1, [enemy(2400, true)], doors)
  const d = t.frame(11.2, [enemy(5050, true)], doors)
  check('landing at a door counts wherever the doors are', d !== undefined && d.how.indexOf('door') === 0)
  const u = fight()
  u.cartCast(11)
  u.frame(11.1, [enemy(2400, true)], doors)
  check('a big jump away from any door does not', u.frame(11.2, [enemy(3600, true)], doors) === undefined)
}
{
  // One cart, two enemies through on the same frame: both count.
  const t = fight()
  t.cartCast(11)
  const doors = [at(5000), at(2600)]
  const two = (x: number, y: number): EnemySample[] => [enemy(x, true), { slot: 6, pos: at(y), alive: true, carted: true }]
  t.frame(10.7, two(2500, 2550), doors)
  t.frame(11.1, two(2400, 2450), doors)
  check('two enemies through on one frame are both detected', t.frameAll(11.2, two(5050, 5100), doors).length === 2)
}
{
  // A jump with no cart at all (e.g. a mobility ability): not a kidnap.
  const t = fight()
  t.frame(11.1, [enemy(2400)])
  check('jump without cart is ignored', t.frame(11.2, [enemy(150)]) === undefined)
}
{
  // Hotel Guest teleports enemies: never a kidnap.
  const t = fight()
  t.cartCast(11)
  t.hotelCast(11)
  t.frame(11.1, [enemy(2400, true)])
  check('hotel teleport is ignored', t.frame(11.2, [enemy(150, true)]) === undefined)
}
{
  // Jump away from the anchor (dragged out the other way): not a kidnap.
  const t = fight()
  t.cartCast(11)
  t.frame(11.1, [enemy(2400, true)])
  check('jump away from anchor is ignored', t.frame(11.2, [enemy(4000, true)]) === undefined)
}
{
  // Dying and respawning at base is a big jump, but the dead frame clears it.
  const t = fight()
  t.cartCast(11)
  t.frame(11.1, [enemy(2400, false, false)])
  t.frame(11.2, [enemy(100)])
  check('respawn after death is ignored', t.frame(11.3, [enemy(110)]) === undefined)
}
{
  // Within the grace window right after the fight starts: ignored.
  const t = new Tracker(cfg, anchor)
  t.startFight(10)
  t.cartCast(10)
  t.frame(10.1, [enemy(2500, true)])
  check('grace window after teleport', t.frame(10.2, [enemy(100, true)]) === undefined)
}
{
  // Cart window without the modifier (modifier name unknown in game): still counts.
  resetCartModifierKnown()
  const t = fight()
  t.cartCast(11)
  t.frame(11.1, [enemy(2400)])
  check('cart window alone counts', t.frame(11.2, [enemy(150)]) !== undefined)
  const late = fight()
  late.cartCast(11)
  late.frame(14.5, [enemy(2400)])
  check('outside the cart window does not', late.frame(14.6, [enemy(150)]) === undefined)
  // Once the game has shown the cart modifier, an uncarted jump in the window is not a kidnap.
  const seen = fight()
  seen.cartCast(11)
  // Another enemy (slot 6) shows the modifier, so the game reports it.
  const other = (carted: boolean): EnemySample => ({ slot: 6, pos: at(3000), alive: true, carted })
  seen.frame(11.05, [enemy(2450), other(true)])
  seen.frame(11.1, [enemy(2400), other(false)])
  check('window alone rejected once the modifier is known', seen.frame(11.2, [enemy(150), other(false)]) === undefined)
  resetCartModifierKnown()
}
{
  // Radius fallback.
  const t = new Tracker({ ...cfg, mode: 'radius' }, anchor)
  t.startFight(10)
  t.frame(10.6, [enemy(2500)])
  t.cartCast(11)
  t.frame(11.1, [enemy(1600)])
  check('radius mode ignores walking into the radius', t.frame(11.2, [enemy(1490)]) === undefined)
  t.frame(11.3, [enemy(1700)])
  check('radius mode detects a fast entry', t.frame(11.4, [enemy(1200)]) !== undefined)
}
{
  // Miss reasons, in combo order.
  const t = new Tracker(cfg, anchor)
  check('miss: no first door', t.missReason() === 'noFirstDoor')
  t.doorCount(1, false)
  check('miss: no second door', t.missReason() === 'noSecondDoor')
  t.doorCount(2, true)
  check('miss: no cart', t.missReason() === 'noCart')
  t.cartCast(12)
  check('miss: cart missed', t.missReason() === 'cartMissed')
  t.startFight(10)
  t.frame(12.1, [enemy(2400, true)])
  check('miss: dragged, missed door', t.missReason() === 'missedDoor')
}
{
  // Ladder: level 1 needs 5 in a row; a miss resets the run.
  resetProgress()
  for (let i = 0; i < 4; i++) recordLevelResult(1, true, false)
  recordLevelResult(1, false, false)
  check('level 1 not passed after a miss', !levelProgress(1).passed && unlockedLevel() === 1)
  let unlocked: number | undefined
  for (let i = 0; i < 5; i++) unlocked = recordLevelResult(1, true, false) ?? unlocked
  check('level 1 passed after 5 in a row', levelProgress(1).passed && unlocked === 2 && unlockedLevel() === 2)
  // Level 4: 5 of the last 8; going through the door is enough.
  for (let i = 0; i < 4; i++) recordLevelResult(4, true, false)
  recordLevelResult(4, false, false)
  check('level 4 not passed at 4 of 5', !levelProgress(4).passed)
  recordLevelResult(4, true, false)
  check('level 4 passes at 5 of the last 8', levelProgress(4).passed)
  const l2 = LEVELS[1]
  const p2 = levelProgress(2)
  for (let i = 0; i < 12; i++) recordLevelResult(2, i % 3 === 0, false)
  check('window only counts the last attempts', passProgress(l2, p2).kidnaps <= l2.window)
  // Streaks are per level.
  resetProgress()
  for (let i = 0; i < 3; i++) recordLevelResult(3, true, false)
  recordLevelResult(5, true, false)
  check('level streaks are separate', levelProgress(3).bestStreak === 3 && levelProgress(5).bestStreak === 1)
  recordLevelResult(3, false, false)
  check('a miss ends the level streak', levelProgress(3).streak === 0 && levelProgress(3).bestStreak === 3)
}

{
  // Endless: waves grow to 6 enemies, time shrinks but never under 15 s.
  check('wave 1 has 1 enemy', waveEnemies(1) === 1 && waveEnemies(3) === 2 && waveEnemies(11) === 6 && waveEnemies(40) === 6)
  check('wave time shrinks after the cap', waveSeconds(12) < waveSeconds(11) && waveSeconds(100) === 15)
  check('bots get smarter every 6 waves, capped at Hard', waveDifficulty(1, 6) === 1 && waveDifficulty(1, 7) === 2 && waveDifficulty(2, 40) === 3)
  const r = startRun(2)
  beginWave(r, 0)
  const a = scoreKidnap(r, 1, 1)
  const b = scoreKidnap(r, 2, 2) // 1 s later: same cart
  const c = scoreKidnap(r, 3, 10) // later: single again
  check('single kidnap scores 100 on wave 1', a.points === 100 && a.multi === 1)
  check('second kidnap within 1.5 s is a multi x2', b.multi === 2 && b.points === 200)
  check('a later kidnap is single again', c.multi === 1 && outCount(r) === 3)
  const before = r.score
  const bonus = clearWave(r, 12.7)
  check('wave clear bonus and advance', bonus === 200 + 120 && r.score === before + bonus && r.wave === 2)
  check('first run is a best, a lower one is not', recordRun(r) && bestFor(2)?.score === r.score && !recordRun({ ...r, score: 1 }))
}

{
  // Hero build: 20000 souls = 14 AP. Doorman maxes Doorway (8), then Cart 1+2, then Bell 1+2.
  const t = plannedTiers(14, [1, 1, 1, 2, 2, 2, 0, 0, 0, 3, 3, 3])
  check('20k souls: Doorway maxed, Cart and Bell tier 2', t[1] === 3 && t[2] === 2 && t[0] === 2 && t[3] === 0)
  check('32 AP maxes everything', plannedTiers(32, [1, 1, 1, 2, 2, 2, 0, 0, 0, 3, 3, 3]).every((x) => x === 3))
  check('0 AP leaves everything at unlocked only', plannedTiers(0, [1, 2]).every((x) => x === 0))
}

{
  // Fighter: aim turns the short way round, limited per tick.
  const a = turnToward({ pitch: 0, yaw: 170, roll: 0 }, { pitch: 0, yaw: -170, roll: 0 }, 5)
  check('aim turns the short way and at most the limit', Math.abs(a.yaw - 175) < 1e-6)
  check('angle between views wraps around', Math.abs(angleBetween({ pitch: 0, yaw: 179, roll: 0 }, { pitch: 0, yaw: -179, roll: 0 }) - 2) < 1e-6)
  const p0 = { x: 0, y: 0, z: 0 }
  const far = fightMove(p0, { x: 2000, y: 0, z: 0 }, p0, [], 2, 1, false, false)
  const near = fightMove(p0, { x: 200, y: 0, z: 0 }, p0, [], 2, 1, false, false)
  check('closes in when far, backs off when close', far.x > 0.3 && near.x < -0.3)
  const dive = fightMove(p0, { x: 700, y: 0, z: 0 }, p0, [], 2, 1, false, false, true)
  const poke = fightMove(p0, { x: 700, y: 0, z: 0 }, p0, [], 2, 1, false, false, false)
  check('a dive runs in where poking holds range', dive.x > 0.7 && Math.abs(poke.x) < 0.2)
  const alone = fightMove(p0, { x: 750, y: 0, z: 0 }, p0, [], 2, -1, false, false)
  const crowded = fightMove(p0, { x: 750, y: 0, z: 0 }, p0, [{ x: 0, y: -100, z: 0 }], 2, -1, false, false)
  check('a bot close by pushes it away', crowded.y > alone.y + 0.3)
}

{
  // Mid-Boss: 4 Medium enemies drain a full Mid-Boss in about 25 s.
  const m = startMidboss(0)
  for (let t = 0.1; t <= 10.001; t += 0.1) drain(m, t, 4, 2)
  check('4 enemies drain 40% in 10 s on Medium', Math.abs(m.hp - 60) < 0.5)
  check('an empty pit drains nothing', Math.abs(drain(m, 10.1, 0, 2)) < 1e-9 && Math.abs(m.hp - 60) < 0.5)
  check('a tick returns what it drained', Math.abs(drain(m, 10.2, 4, 2) - 0.4) < 1e-9 && Math.abs(m.hp - 59.6) < 0.5)
  m.hp = 60
  kidnapped(m, 5, 10, 15)
  check('a kidnapped enemy is out for its respawn time', m.out[5] === 25 && m.kidnaps === 1)
  check('score: kidnaps, health left, hold bonus', midbossScore(m, true) === 100 + 600 + 500)
}

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) throw new Error(`${failed} test(s) failed`)
