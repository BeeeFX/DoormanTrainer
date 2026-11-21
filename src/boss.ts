import { findEntities, Npc, removeEntities, spawnNpc, type Angles, type NpcState, type Vector } from 'modlock'
import { log } from './util'

// The real Mid-Boss (npc_super_neutral) for the Mid-Boss mode. The map's own
// one is used when it's up; otherwise the mod spawns one at the pit's floor.
// Its health is the fight's health bar: real hits count, and round.ts drains
// it for every enemy standing in the pit. If it can't be spawned, the mode
// falls back to a simulated bar.

const CLASS = 'npc_super_neutral'

let npc: Npc | undefined
let spawnedByMod = false
let refused = false

export function bossEntity(): number | undefined {
  return npc ? npc.entity : undefined
}

export function bossState(): NpcState | undefined {
  if (!npc) return undefined
  const s = npc.read()
  if (!s) npc = undefined
  return s
}

// The Mid-Boss at full health, spawning it at `pos` if there's none.
export function ensureBoss(pos: Vector, facing: Angles): NpcState | undefined {
  let s = bossState()
  if (!s) {
    const found = findEntities(CLASS)
    if (found.length > 0) {
      npc = new Npc(found[0])
      spawnedByMod = false
    } else if (!refused) {
      npc = spawnNpc({ className: CLASS, unit: CLASS, team: 4, position: pos, facing })
      spawnedByMod = npc !== undefined
      if (!npc) {
        refused = true
        log('the game refused to spawn the Mid-Boss: the mode uses a simulated health bar')
      } else log('spawned the Mid-Boss in the pit')
    }
    s = bossState()
  }
  if (npc && s) {
    npc.setHealth(s.maxHealth)
    s = npc.read()
  }
  return s
}

// Sets its health as a percentage of the maximum.
export function setBossPercent(percent: number): void {
  const s = bossState()
  if (npc && s) npc.setHealth(Math.max(1, Math.round((s.maxHealth * percent) / 100)))
}

// Takes it out without rewards: no Rejuvenator for the bots.
export function removeBoss(): void {
  if (npc) removeEntities(CLASS)
  npc = undefined
}

// Takes out a Mid-Boss the mod spawned, when another mode starts.
export function removeSpawnedBoss(): void {
  if (npc && spawnedByMod) removeBoss()
}

// A new world: the old handle is gone.
export function forgetBoss(): void {
  npc = undefined
  spawnedByMod = false
  refused = false
}
