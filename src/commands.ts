import { command, toast, vector, type Player } from 'modlock'
import { BEHAVIOURS, DIFFICULTY_TITLES, doorRangeUnits, saveSettings, settings, teamTitle } from './config'
import { doorPositions } from './doors'
import { isUnlocked, LEVELS } from './levels'
import { allLocations, customTowers, findCustom, findLocation, generateBuiltins, mapSummary, saveCustom } from './locations'
import { clearPlan, hideCurrentSpot, rebuildHuman, skip, start, stop } from './round'
import { resetStats, stats } from './stats'
import { OUTCOME_TITLES, type Outcome } from './tracker'
import { closeMenu, isMenuOpen, markDirty, openMenu } from './ui'
import { fmtAng, fmtVec, isDebug, log, setDebug } from './util'
import { removeAll } from './bots'

function say(p: Player, text: string): void {
  toast(p, text, 5)
  p.chat(text)
}

function changed(): void {
  saveSettings()
  markDirty()
}

function num(args: string): number {
  return Number(args.trim().split(/\s+/)[0])
}

const HELP = [
  '/dt — open or close the menu (also /kt, /menu)',
  '/start /stop /skip — round loop',
  '/level <1-10>, /custom — training mode',
  '/bots <1-6>, /allies <0-5>, /difficulty easy|medium|hard, /behaviour still|walk|fight',
  '/souls <n>, /team 2|3, /fastcd real|short|none, /invincible on|off, /range on|off',
  '/tower <name>, /fight [name], /spots, /goto <location> [spot], /deltower <name>, /delfight <name> <i>, /badspot',
  '/probe, /where, /units <u per m>, /relocate, /detect track|radius, /debug on|off, /stats, /resetstats',
]

export function registerCommands(): void {
  const menu = (p: Player) => (isMenuOpen() ? closeMenu(p) : openMenu(p))
  command('dt', menu)
  command('kt', menu)
  command('menu', menu)
  command('help', (p) => {
    for (const l of HELP) p.chat(l)
  })

  command('start', (p) => {
    if (isMenuOpen()) closeMenu(p)
    const err = start()
    if (err) say(p, err)
  })
  command('stop', (p) => {
    stop()
    say(p, 'Stopped. /start to go again.')
  })
  command('skip', () => skip())

  command('level', (p, a) => {
    const n = Math.round(num(a))
    if (!(n >= 1 && n <= LEVELS.length)) return say(p, `Levels are 1-${LEVELS.length}.`)
    if (!isUnlocked(n)) return say(p, `Level ${n} is locked. Pass level ${n - 1} first.`)
    settings.mode = 'ladder'
    settings.level = n
    changed()
    say(p, `Level ${n} · ${LEVELS[n - 1].name}`)
  })
  command('custom', (p) => {
    settings.mode = 'custom'
    changed()
    say(p, 'Custom mode')
  })

  command('bots', (p, a) => {
    settings.enemies = num(a)
    settings.mode = 'custom'
    changed()
    say(p, `Custom: ${settings.enemies} enemies`)
  })
  command('allies', (p, a) => {
    settings.allies = num(a)
    settings.mode = 'custom'
    changed()
    say(p, `Custom: ${settings.allies} allies`)
  })
  command('difficulty', (p, a) => {
    const i = DIFFICULTY_TITLES.map((t) => t.toLowerCase()).indexOf(a.trim().toLowerCase())
    const n = i >= 0 ? i + 1 : Math.round(num(a))
    if (!(n >= 1 && n <= 3)) return say(p, 'easy, medium or hard')
    settings.difficulty = n
    settings.mode = 'custom'
    changed()
    say(p, `Custom: ${DIFFICULTY_TITLES[n - 1]} bots`)
  })
  command('behaviour', (p, a) => {
    const b = a.trim().toLowerCase()
    const i = BEHAVIOURS.indexOf(b as (typeof BEHAVIOURS)[number])
    if (i < 0) return say(p, 'still, walk or fight')
    settings.behaviour = BEHAVIOURS[i]
    settings.mode = 'custom'
    changed()
    say(p, `Custom: behaviour ${b}`)
  })
  command('souls', (p, a) => {
    settings.souls = num(a)
    changed()
    rebuildHuman(false)
    say(p, `Build: ${settings.souls} souls`)
  })
  command('team', (p, a) => {
    const t = Math.round(num(a))
    if (t !== 2 && t !== 3) return say(p, '/team 2 or /team 3')
    stop()
    settings.team = t
    changed()
    removeAll()
    clearPlan()
    p.seat({ hero: 'doorman', team: t })
    rebuildHuman(true)
    say(p, `You're on ${teamTitle(t)}`)
  })
  command('fastcd', (p, a) => {
    const v = a.trim()
    settings.cooldowns = v === 'none' ? 'none' : v === 'off' || v === 'real' ? 'real' : 'short'
    changed()
    rebuildHuman(false)
    say(p, `Cooldowns: ${settings.cooldowns}`)
  })
  command('invincible', (p, a) => {
    settings.invincible = a.trim() === '' ? !settings.invincible : a.trim() === 'on'
    changed()
    say(p, `Invincible ${settings.invincible ? 'on' : 'off'}`)
  })
  command('range', (p, a) => {
    settings.rangeUpgrade = a.trim() !== 'off'
    changed()
    generateBuiltins()
    clearPlan()
    say(p, `Doorway range upgrade ${settings.rangeUpgrade ? 'on' : 'off'}: ${Math.round(doorRangeUnits())} u`)
  })

  // ---- custom spots ----
  command('tower', (p, a) => {
    const name = a.trim()
    const pawn = p.pawn()
    if (!name || !pawn) return say(p, '/tower <name>')
    let t = findCustom(name)
    if (!t) {
      t = { name, team: settings.team, pos: pawn.position, facing: { pitch: 0, yaw: pawn.eyeAngles.yaw, roll: 0 }, fights: [] }
      customTowers().push(t)
    } else {
      t.pos = pawn.position
      t.facing = { pitch: 0, yaw: pawn.eyeAngles.yaw, roll: 0 }
      t.team = settings.team
    }
    // Make it the current one: last in the list.
    const list = customTowers()
    list.splice(list.indexOf(t), 1)
    list.push(t)
    saveCustom()
    markDirty()
    say(p, `Anchor '${name}' saved at ${fmtVec(pawn.position)}`)
  })
  command('fight', (p, a) => {
    const pawn = p.pawn()
    const list = customTowers()
    const t = a.trim() ? findCustom(a.trim()) : list[list.length - 1]
    if (!pawn || !t) return say(p, 'Record an anchor first with /tower <name>')
    t.fights.push({ pos: pawn.position, facing: { pitch: 0, yaw: pawn.eyeAngles.yaw, roll: 0 } })
    saveCustom()
    markDirty()
    const d = vector.distance(pawn.position, t.pos)
    const range = doorRangeUnits()
    say(p, `Fight spot ${t.fights.length} for '${t.name}': ${Math.round(d)} u from the anchor (${Math.round((d / range) * 100)}% of door range)${d > range ? ' — TOO FAR' : ''}`)
  })
  command('badspot', (p) => {
    const name = hideCurrentSpot()
    say(p, name ? `Hidden: ${name}. Restore hidden spots in /dt → Locations.` : 'No spot to hide yet.')
  })
  command('spots', (p) => {
    const locs = allLocations(settings.team)
    if (locs.length === 0) return say(p, 'No locations.')
    for (const l of locs) p.chat(`${l.name} [${l.id}]: ${l.fights.length} fight spots`)
  })
  command('goto', (p, a) => {
    const parts = a.trim().split(/\s+/)
    const idx = parts.length > 1 ? Number(parts[parts.length - 1]) : NaN
    const name = Number.isFinite(idx) ? parts.slice(0, -1).join(' ') : parts.join(' ')
    const l = findLocation(settings.team, name)
    if (!l) return say(p, `No location '${name}'. /spots lists them.`)
    stop()
    const s = Number.isFinite(idx) && idx >= 1 ? l.fights[idx - 1] : l.anchor
    if (!s) return say(p, `${l.name} has ${l.fights.length} fight spots.`)
    p.teleport(s.pos, s.facing)
    say(p, `${l.name} · ${Number.isFinite(idx) ? `fight ${idx}` : 'anchor'}`)
  })
  command('deltower', (p, a) => {
    const t = findCustom(a.trim())
    if (!t) return say(p, `No custom anchor '${a.trim()}'`)
    customTowers().splice(customTowers().indexOf(t), 1)
    saveCustom()
    markDirty()
    say(p, `Deleted '${t.name}'`)
  })
  command('delfight', (p, a) => {
    const parts = a.trim().split(/\s+/)
    const t = findCustom(parts[0] ?? '')
    const i = Number(parts[1])
    if (!t || !(i >= 1 && i <= t.fights.length)) return say(p, '/delfight <name> <index>')
    t.fights.splice(i - 1, 1)
    saveCustom()
    markDirty()
    say(p, `Deleted fight ${i} of '${t.name}'`)
  })

  // ---- tuning and diagnostics ----
  command('where', (p) => {
    const pawn = p.pawn()
    if (pawn) say(p, `pos ${fmtVec(pawn.position)} angles ${fmtAng(pawn.eyeAngles)}`)
  })
  command('probe', (p) => {
    for (const ab of p.abilities()) p.chat(`ability slot ${ab.slot}: ${ab.name} (upgrades ${ab.upgrades})`)
    const m = mapSummary()
    p.chat(`map: ${m.guardians} guardians, ${m.walkers} walkers, ${m.patrons} patrons, midboss ${m.midboss ? 'yes' : 'no'}`)
    const doors = doorPositions()
    p.chat(`doors open: ${doors.length}`)
    if (doors.length >= 2) {
      const d = vector.distance(doors[0], doors[1])
      p.chat(`door distance ${Math.round(d)} u. If placed at max distance: ${(d / 70).toFixed(2)} u/m (or ${(d / 110).toFixed(2)} with the range upgrade). Set it with /units.`)
    }
    log('probe done')
  })
  command('units', (p, a) => {
    const v = num(a)
    if (!(v > 1)) return say(p, `/units <units per metre>, now ${settings.unitsPerMetre}`)
    settings.unitsPerMetre = v
    changed()
    generateBuiltins()
    clearPlan()
    say(p, `${v} u/m · door range ${Math.round(doorRangeUnits())} u · built-in spots regenerated`)
  })
  command('relocate', (p) => {
    generateBuiltins()
    markDirty()
    say(p, `${allLocations(settings.team).length} locations for your side`)
  })
  command('detect', (p, a) => {
    settings.detect = a.trim() === 'radius' ? 'radius' : 'track'
    changed()
    say(p, `Detection: ${settings.detect}`)
  })
  command('debug', (p, a) => {
    setDebug(a.trim() === '' ? !isDebug() : a.trim() === 'on')
    markDirty()
    say(p, `Debug ${isDebug() ? 'on (server console)' : 'off'}`)
  })
  command('stats', (p) => {
    p.chat(`attempts ${stats.attempts}, kidnaps ${stats.kidnaps}, streak ${stats.streak} (best ${stats.bestStreak})`)
    for (const k of Object.keys(stats.misses)) p.chat(`  ${OUTCOME_TITLES[k as Outcome] ?? k}: ${stats.misses[k]}`)
  })
  command('resetstats', (p) => {
    resetStats()
    markDirty()
    say(p, 'Stats cleared')
  })
}
