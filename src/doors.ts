import { entityPosition, findEntities, fireInput, type Vector } from 'modlock'

export const DOOR_CLASS = 'citadel_doorway_portal'

export function doorEntities(): number[] {
  return findEntities(DOOR_CLASS)
}

export function doorPositions(): Vector[] {
  const out: Vector[] = []
  for (const e of doorEntities()) {
    const p = entityPosition(e)
    if (p) out.push(p.position)
  }
  return out
}

export function closeDoors(): number {
  let n = 0
  for (const e of doorEntities()) if (fireInput(e, 'Close')) n++
  return n
}
