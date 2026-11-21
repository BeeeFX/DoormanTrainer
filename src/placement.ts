import { ground, trace, Layers, vector, type Angles, type Vector } from 'modlock'
import type { Spot } from './locations'
import { rand } from './util'

export interface Placed {
  pos: Vector
  facing: Angles
}

function flatDist(a: Vector, b: Vector): number {
  return vector.flatDistance(a, b)
}

// Places `count` bodies in an arc around `center`, facing `faceToward`.
// yawCenter ± spread (degrees), between minDist and maxDist units away.
// Each point is on solid ground with line of sight from the centre.
export function arc(center: Spot, count: number, yawCenter: number, spread: number, minDist: number, maxDist: number, faceToward: Vector, keepAway: Vector[]): Placed[] {
  const out: Placed[] = []
  const eye = vector.add(center.pos, { x: 0, y: 0, z: 64 })
  for (let n = 0; n < count; n++) {
    let pos: Vector | undefined
    for (let attempt = 0; attempt < 10 && !pos; attempt++) {
      const yaw = yawCenter + rand(-spread, spread)
      const dir = vector.forward(vector.level(yaw))
      const dist = rand(minDist, maxDist)
      let want = vector.add(eye, vector.scale(dir, dist))
      const hit = trace({ start: eye, end: want, layers: Layers.solid })
      if (hit) want = vector.sub(hit.position, vector.scale(dir, 80)) // stop short of walls
      if (flatDist(want, center.pos) < minDist * 0.5) continue
      const floor = ground(want, { above: 64, below: 1500 })
      if (!floor) continue
      const candidate = vector.add(floor, { x: 0, y: 0, z: 8 })
      if (Math.abs(candidate.z - center.pos.z) > 600) continue // a different floor, likely a roof or a pit
      let crowded = false
      for (const o of out) if (flatDist(o.pos, candidate) < 120) crowded = true
      for (const k of keepAway) if (flatDist(k, candidate) < 200) crowded = true
      if (crowded) continue
      pos = candidate
    }
    if (!pos) {
      // Fallback: beside the centre.
      const side = vector.forward(vector.level(yawCenter + 90 + n * 40))
      const p = ground(vector.add(center.pos, vector.scale(side, 150 + n * 60)), { above: 64, below: 1500 })
      pos = p ? vector.add(p, { x: 0, y: 0, z: 8 }) : vector.add(center.pos, vector.scale(side, 150 + n * 60))
    }
    out.push({ pos, facing: vector.level(vector.yawToward(pos, faceToward)) })
  }
  return out
}

// Enemies in front of the recorded fight facing.
export function placeEnemies(fight: Spot, count: number): Placed[] {
  return arc(fight, count, fight.facing.yaw, 60, 500, 1100, fight.pos, [fight.pos])
}

// Mid-Boss: enemies around the boss, mostly on the enemy side of the pit
// (the pit spot faces the enemy base), clear of the boss and of you.
export function placeInPit(pit: Spot, count: number, you: Vector): Placed[] {
  return arc(pit, count, pit.facing.yaw, 85, 320, 700, pit.pos, [pit.pos, you])
}

// Allies behind the player, or waiting at the anchor.
export function placeAllies(fight: Spot, anchor: Spot, count: number, atAnchor: boolean, avoid: Vector[]): Placed[] {
  if (atAnchor) return arc(anchor, count, anchor.facing.yaw, 70, 150, 400, fight.pos, avoid.concat([anchor.pos]))
  return arc(fight, count, fight.facing.yaw + 180, 50, 200, 500, vector.add(fight.pos, vector.scale(vector.forward(fight.facing), 800)), avoid.concat([fight.pos]))
}
