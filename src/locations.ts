import { entityPosition, findEntities, ground, readField, trace, Layers, vector, type Angles, type Vector } from 'modlock'
import { doorRangeUnits, settings, type SpotFilter } from './config'
import { dbg, fmtVec, loadJson, log, saveJson } from './util'

export interface Spot {
  pos: Vector
  facing: Angles
}

export type LocationKind = 'guardian' | 'walker' | 'midboss' | 'custom'

export interface Location {
  id: string
  name: string
  team: number
  kind: LocationKind
  anchor: Spot // where door #1 goes and the victim should end up
  fights: Spot[]
  alliesAtAnchor: boolean // allies wait at the anchor (Mid-Boss: "kidnap to your team")
  pit?: Spot // Mid-Boss: the pit floor's centre, where the Mid-Boss stands
}

// ---- custom spots (spots.json, format from the design brief) ----

interface StoredTower {
  name: string
  team: number
  pos: Vector
  facing: Angles
  fights: Spot[]
}
interface SpotsFile {
  towers: StoredTower[]
}

const SPOTS_FILE = 'spots.json'
const custom: SpotsFile = loadJson<SpotsFile>(SPOTS_FILE, { towers: [] })
if (!Array.isArray(custom.towers)) custom.towers = []

export function customTowers(): StoredTower[] {
  return custom.towers
}
export function saveCustom(): void {
  saveJson(SPOTS_FILE, custom)
}
export function findCustom(name: string): StoredTower | undefined {
  const n = name.toLowerCase()
  for (const t of custom.towers) if (t.name.toLowerCase() === n) return t
  return undefined
}

// ---- built-in locations, generated from the map's entities ----

let builtins: Location[] = []

export interface MapInfo {
  guardians: number
  walkers: number
  patrons: number
  midboss: boolean
  bases: Record<number, Vector | undefined>
}
let mapInfo: MapInfo = { guardians: 0, walkers: 0, patrons: 0, midboss: false, bases: {} }
export function mapSummary(): MapInfo {
  return mapInfo
}

function teamOf(e: number): number {
  const v = readField(e, 'CBaseEntity', 'm_iTeamNum', 'uint8')
  return typeof v === 'number' ? v : 0
}

interface Tower {
  pos: Vector
  team: number
}

function towersOf(className: string): Tower[] {
  const out: Tower[] = []
  for (const e of findEntities(className)) {
    const p = entityPosition(e)
    if (!p) continue
    const team = teamOf(e)
    if (team !== 2 && team !== 3) continue
    out.push({ pos: p.position, team })
  }
  return out
}

function flat(v: Vector): Vector {
  return { x: v.x, y: v.y, z: 0 }
}

function average(list: Vector[]): Vector | undefined {
  if (list.length === 0) return undefined
  let x = 0
  let y = 0
  let z = 0
  for (const v of list) {
    x += v.x
    y += v.y
    z += v.z
  }
  return { x: x / list.length, y: y / list.length, z: z / list.length }
}

// Finds standable ground near a point: floor below, with headroom above.
// It searches from just above the point first, so a spot under a bridge or an
// overhang stays on the street instead of landing on the roof; a higher start
// only catches ramps going up. Ground far from the point's height is refused.
// The floor must sit near the expected height: at most 150 below (an opening
// in the street drops to the sewers far lower) or 400 above (ramps up). A
// floor below the expected height with a ceiling over it is a tunnel: refused.
export function standable(p: Vector): Vector | undefined {
  let g = ground({ x: p.x, y: p.y, z: p.z + 72 }, { above: 0, below: 300 })
  if (!g) g = ground({ x: p.x, y: p.y, z: p.z + 400 }, { above: 0, below: 400 })
  if (!g || g.z < p.z - 150 || g.z > p.z + 400) return undefined
  const head = trace({ start: { x: g.x, y: g.y, z: g.z + 8 }, end: { x: g.x, y: g.y, z: g.z + 80 }, layers: Layers.solid })
  if (head) return undefined
  if (g.z < p.z - 40) {
    const roof = trace({ start: { x: g.x, y: g.y, z: g.z + 80 }, end: { x: g.x, y: g.y, z: g.z + 600 }, layers: Layers.solid })
    if (roof) return undefined
  }
  return { x: g.x, y: g.y, z: g.z + 8 }
}

function spot(pos: Vector, yaw: number): Spot {
  return { pos, facing: vector.level(yaw) }
}

const LANE_NAMES: Record<number, readonly string[]> = {
  2: ['Left', 'Right'],
  3: ['Left', 'Middle', 'Right'],
  4: ['Far-left', 'Left', 'Right', 'Far-right'],
}

function laneNames(towers: Tower[], ownBase: Vector, enemyBase: Vector): string[] {
  const a = vector.normalize(flat(vector.sub(enemyBase, ownBase)))
  const left = { x: -a.y, y: a.x, z: 0 } // +90° yaw is to the left
  const order = towers
    .map((t, i) => ({ i, d: vector.dot(flat(vector.sub(t.pos, ownBase)), left) }))
    .sort((p, q) => q.d - p.d)
  const names: string[] = []
  order.forEach((o, rank) => {
    const set = LANE_NAMES[towers.length]
    names[o.i] = set ? set[rank] : `Lane ${rank + 1}`
  })
  return names
}

// Clear line of sight at chest height between two standing points.
function clearLine(a: Vector, b: Vector): boolean {
  return !trace({ start: { x: a.x, y: a.y, z: a.z + 60 }, end: { x: b.x, y: b.y, z: b.z + 60 }, layers: Layers.solid })
}

function towerLocations(kind: 'guardian' | 'walker', all: Tower[], bases: Record<number, Vector | undefined>, range: number): Location[] {
  const out: Location[] = []
  for (const team of [2, 3]) {
    const own = all.filter((t) => t.team === team)
    const enemy = all.filter((t) => t.team !== team)
    const ownBase = bases[team]
    const enemyBase = bases[team === 2 ? 3 : 2]
    const names = ownBase && enemyBase ? laneNames(own, ownBase, enemyBase) : own.map((_, i) => `Lane ${i + 1}`)
    // Lanes sit side by side across the base-to-base axis: an own tower and
    // the enemy tower of the same lane share about the same sideways offset.
    // (The nearest enemy tower can be in the neighbouring lane.)
    const axis = ownBase && enemyBase ? vector.normalize(flat(vector.sub(enemyBase, ownBase))) : undefined
    const mid = ownBase && enemyBase ? vector.lerp(ownBase, enemyBase, 0.5) : undefined
    const sideOf = (v: Vector) => (axis && mid ? vector.dot(flat(vector.sub(v, mid)), { x: -axis.y, y: axis.x, z: 0 }) : 0)
    own.forEach((t, i) => {
      let nearest: Tower | undefined
      for (const e of enemy) {
        const score = axis ? Math.abs(sideOf(e.pos) - sideOf(t.pos)) : vector.flatDistance(t.pos, e.pos)
        const best = nearest ? (axis ? Math.abs(sideOf(nearest.pos) - sideOf(t.pos)) : vector.flatDistance(t.pos, nearest.pos)) : Infinity
        if (score < best) nearest = e
      }
      const towardEnemy = nearest ? vector.normalize(flat(vector.sub(nearest.pos, t.pos))) : enemyBase ? vector.normalize(flat(vector.sub(enemyBase, t.pos))) : { x: 1, y: 0, z: 0 }
      const yaw = vector.yawToward({ x: 0, y: 0, z: 0 }, towardEnemy)
      const side = { x: -towardEnemy.y, y: towardEnemy.x, z: 0 }
      const anchorPos = standable(vector.sub(t.pos, vector.scale(towardEnemy, 250)))
      if (!anchorPos) {
        dbg(`no ground behind ${kind} at ${fmtVec(t.pos)}`)
        return
      }
      const fights: Spot[] = []
      const fracs = [0.45, 0.65, 0.85]
      const preferredSide = [0, 300, -300]
      // Look from just in front of the tower (the tower's own body blocks traces).
      const lookout = standable(vector.add(t.pos, vector.scale(towardEnemy, 350))) ?? anchorPos
      for (let k = 0; k < fracs.length; k++) {
        const centre = vector.add(t.pos, vector.scale(towardEnemy, fracs[k] * range))
        // Try the preferred sideways offset first, then others; prefer a spot
        // the lane can see, so the fight isn't behind a building.
        const offsets = [preferredSide[k], 0, 300, -300, 600, -600].filter((o, j, a) => a.indexOf(o) === j)
        let open: Vector | undefined
        let any: Vector | undefined
        for (const o of offsets) {
          const p = standable(vector.add(centre, vector.scale(side, o)))
          if (!p || vector.distance(p, anchorPos) > range * 0.95) continue
          if (!any) any = p
          if (clearLine(lookout, p)) {
            open = p
            break
          }
        }
        const chosen = open ?? any
        if (chosen) fights.push(spot(chosen, yaw))
        if (!open && chosen) dbg(`${kind} ${names[i]}: fight ${k + 1} has no clear line from the tower`)
      }
      if (fights.length === 0) return
      const tier = kind === 'guardian' ? 'Guardian' : 'Walker'
      out.push({
        id: `${kind}-${team}-${names[i].toLowerCase()}`,
        name: `${names[i]} ${tier}`,
        team,
        kind,
        anchor: spot(anchorPos, yaw),
        fights,
        alliesAtAnchor: false,
      })
    })
  }
  return out
}

// The lowest floor open to the sky in a column, between `top` and `bottom`.
// Traces down through each surface (roofs, bridges, ledges); a floor with a
// roof over it (the sewers) never counts. At the map centre that is the
// Mid-Boss pit's bottom; at the pit's edge it is the street.
export function lowestOpenFloor(x: number, y: number, top: number, bottom: number): Vector | undefined {
  let from = top
  let best: Vector | undefined
  for (let hits = 0; hits < 10 && from > bottom; hits++) {
    const g = ground({ x, y, z: from }, { above: 0, below: from - bottom })
    if (!g) break
    const head = trace({ start: { x: g.x, y: g.y, z: g.z + 8 }, end: { x: g.x, y: g.y, z: g.z + 80 }, layers: Layers.solid })
    const roof = trace({ start: { x: g.x, y: g.y, z: g.z + 80 }, end: { x: g.x, y: g.y, z: g.z + 600 }, layers: Layers.solid })
    if (!head && !roof) best = { x: g.x, y: g.y, z: g.z + 8 }
    from = g.z - 40 // continue below this surface
  }
  return best
}

export function pitFloor(center: Vector): Vector {
  return lowestOpenFloor(center.x, center.y, center.z + 1500, center.z - 4000) ?? center
}

function midbossLocations(center: Vector, bases: Record<number, Vector | undefined>, range: number): Location[] {
  const out: Location[] = []
  // Fight spots sit on the pit floor; door 1 goes up at street level on your side.
  const floor = pitFloor(center)
  if (Math.abs(floor.z - center.z) > 100) log(`Mid-Boss pit floor ${Math.round(center.z - floor.z)} u below the map's middle`)
  for (const team of [2, 3]) {
    const ownBase = bases[team]
    const enemyBase = bases[team === 2 ? 3 : 2]
    if (!ownBase || !enemyBase) continue
    const toEnemy = vector.normalize(flat(vector.sub(enemyBase, ownBase)))
    const yaw = vector.yawToward({ x: 0, y: 0, z: 0 }, toEnemy)
    const side = { x: -toEnemy.y, y: toEnemy.x, z: 0 }
    // Door 1 at the pit's edge on your side, on the street.
    const edge = vector.sub(floor, vector.scale(toEnemy, 0.55 * range))
    const anchorPos = lowestOpenFloor(edge.x, edge.y, center.z + 1500, floor.z - 50)
    if (!anchorPos) {
      log(`Mid-Boss pit (team ${team}): no open ground for door 1 at the pit's edge`)
      continue
    }
    const fights: Spot[] = []
    // The Mid-Boss stands at the pit floor's centre; you start on your side of
    // it, then spots across the pit. Ones that land on a wall or back up at
    // street level (far from the floor's height) are skipped.
    const wants = [
      vector.sub(floor, vector.scale(toEnemy, 320)),
      floor,
      vector.add(vector.add(floor, vector.scale(toEnemy, 350)), vector.scale(side, 300)),
      vector.add(vector.add(floor, vector.scale(toEnemy, 350)), vector.scale(side, -300)),
      vector.add(floor, vector.scale(side, 450)),
      vector.add(floor, vector.scale(side, -450)),
    ]
    for (const w of wants) {
      if (fights.length >= 3) break
      const p = lowestOpenFloor(w.x, w.y, floor.z + 400, floor.z - 300)
      if (!p || Math.abs(p.z - floor.z) > 150) continue
      if (vector.distance(p, anchorPos) <= range * 0.95) fights.push(spot(p, yaw))
    }
    if (fights.length === 0) continue
    out.push({ id: `midboss-${team}`, name: 'Mid-Boss pit', team, kind: 'midboss', anchor: spot(anchorPos, yaw), fights, alliesAtAnchor: true, pit: spot(floor, yaw) })
  }
  return out
}

export function generateBuiltins(): void {
  const range = doorRangeUnits()
  const guardians = towersOf('npc_trooper_boss')
  const walkers = towersOf('npc_boss_tier2')
  const patrons = towersOf('npc_boss_tier3')
  const bases: Record<number, Vector | undefined> = {}
  for (const team of [2, 3]) {
    const own = patrons.filter((p) => p.team === team).map((p) => p.pos)
    bases[team] = average(own) ?? average(walkers.filter((w) => w.team === team).map((w) => w.pos)) ?? average(guardians.filter((g) => g.team === team).map((g) => g.pos))
  }
  let center: Vector | undefined
  const mid = findEntities('npc_super_neutral')
  if (mid.length > 0) center = entityPosition(mid[0])?.position
  if (!center && bases[2] && bases[3]) center = vector.lerp(bases[2], bases[3], 0.5)

  builtins = []
  builtins.push(...towerLocations('guardian', guardians, bases, range))
  builtins.push(...towerLocations('walker', walkers, bases, range))
  if (center) builtins.push(...midbossLocations(center, bases, range))
  mapInfo = { guardians: guardians.length, walkers: walkers.length, patrons: patrons.length, midboss: mid.length > 0, bases }
  log(`map: ${guardians.length} guardians, ${walkers.length} walkers, ${patrons.length} patrons, midboss ${mid.length > 0 ? 'found' : 'not found'}; ${builtins.length} built-in locations (door range ${Math.round(range)} u)`)
  for (const team of [2, 3]) {
    const mine = builtins.filter((l) => l.team === team).map((l) => `${l.name} (${l.fights.length})`)
    log(`  team ${team}: ${mine.join(', ') || 'none'}`)
  }
}

function customLocations(): Location[] {
  return custom.towers
    .filter((t) => t.fights.length > 0)
    .map((t) => ({
      id: `custom-${t.name.toLowerCase()}`,
      name: `Custom: ${t.name}`,
      team: t.team,
      kind: 'custom' as LocationKind,
      anchor: { pos: t.pos, facing: t.facing },
      fights: t.fights,
      alliesAtAnchor: false,
    }))
}

// Every location of the given team, built-in first.
export function allLocations(team: number): Location[] {
  return builtins.filter((l) => l.team === team).concat(customLocations().filter((l) => l.team === team))
}

// Ids are stored without the team so a selection survives a side switch.
export function selectionKey(l: Location): string {
  if (l.kind === 'custom') return l.id
  return l.id.replace(/-[23](-|$)/, '$1')
}

export function selectedLocations(team: number): Location[] {
  const all = allLocations(team)
  if (settings.locations.length === 0) return all
  const chosen = all.filter((l) => settings.locations.indexOf(selectionKey(l)) >= 0)
  return chosen.length > 0 ? chosen : all
}

export function spotFraction(l: Location, f: Spot): number {
  return vector.distance(l.anchor.pos, f.pos) / doorRangeUnits()
}

export interface Pick {
  location: Location
  fightIndex: number
}

let lastPickKey = ''

// Spots hidden with /badspot, as "<location key>#<fight index>".
export function spotKey(l: Location, fightIndex: number): string {
  return `${selectionKey(l)}#${fightIndex}`
}
export function isHidden(l: Location, fightIndex: number): boolean {
  return settings.hiddenSpots.indexOf(spotKey(l, fightIndex)) >= 0
}

export function pickRound(team: number, filter: SpotFilter): Pick | undefined {
  const locs = selectedLocations(team)
  const candidates: Pick[] = []
  for (const l of locs) {
    l.fights.forEach((f, i) => {
      if (isHidden(l, i)) return
      const frac = spotFraction(l, f)
      if (filter === 'close' && frac > 0.6) return
      if (filter === 'far' && frac < 0.65) return
      candidates.push({ location: l, fightIndex: i })
    })
  }
  if (candidates.length === 0) {
    // The filter removed everything: fall back to any spot of the selection.
    for (const l of locs) l.fights.forEach((_, i) => {
      if (!isHidden(l, i)) candidates.push({ location: l, fightIndex: i })
    })
  }
  if (candidates.length === 0) return undefined
  const fresh = candidates.filter((c) => `${c.location.id}#${c.fightIndex}` !== lastPickKey)
  const pool = fresh.length > 0 ? fresh : candidates
  const p = pool[Math.floor(Math.random() * pool.length)]
  lastPickKey = `${p.location.id}#${p.fightIndex}`
  return p
}

// The Mid-Boss mode always fights at the pit's centre.
export function midbossPick(team: number): Pick | undefined {
  const l = builtins.find((x) => x.team === team && x.kind === 'midboss')
  return l ? { location: l, fightIndex: 0 } : undefined
}

export function findLocation(team: number, typed: string): Location | undefined {
  const t = typed.toLowerCase()
  const all = allLocations(team)
  for (const l of all) if (l.id === t || selectionKey(l) === t || l.name.toLowerCase() === t) return l
  for (const l of all) if (l.name.toLowerCase().indexOf(t) >= 0) return l
  return undefined
}
