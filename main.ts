// Doorman Trainer: drills for Doorman, starting with the door + Luggage Cart "kidnap".
// How it works: docs/DEVELOPING.md.
import { handleInput, keysFrame, registerKeys } from './src/keys'
import { after, connection, onAbilityCast, onDamage, onFrame, onInput, type Player, onKill, onLaunch, onPlayerJoin, onPlayerLeave, onSpawn, onStart, onWorld, setRespawnDelay, watchProjectiles } from 'modlock'
import { apply, arena } from 'modlock/console'
import { onBotSpawn, removeAll } from './src/bots'
import { registerCommands } from './src/commands'
import { settings } from './src/config'
import { generateBuiltins } from './src/locations'
import { bossEntity, forgetBoss } from './src/boss'
import { clearPlan, currentPhase, frame, holdBot, getHuman, onCast, onKillEvent, onProjectile, rebuildHuman, setHuman, stop } from './src/round'
import { draw, markDirty, openMenu, resetUi } from './src/ui'
import { flushSaves, log, setNow } from './src/util'

onStart(() => {
  const refused = apply({
    ...arena,
    citadel_allow_purchasing_anywhere: true,
    citadel_allow_duplicate_heroes: true,
    citadel_default_bot_difficulty: settings.difficulty,
    citadel_trooper_spawn_enabled: settings.troopers,
  })
  if (refused.length > 0) log('console variables refused:', refused.join(', '))
  watchProjectiles({ names: ['projectile_doorman_cart_projectile', 'doorman_cart_projectile'] })
  // Watch Reload / Use / Jump once the server runs; a watch set before that is lost.
  registerKeys()
})

setRespawnDelay(2)
registerCommands()

onWorld((map) => {
  // A new map removes bots; built-in locations come from this map's entities.
  removeAll()
  forgetBoss()
  stop()
  clearPlan()
  generateBuiltins()
  log(`world ${map}`)
  registerKeys()
  markDirty()
  // Guardians and the Mid-Boss spawn a moment after the map loads: look again.
  after(5, () => {
    generateBuiltins()
    markDirty()
  })
  after(20, () => {
    generateBuiltins()
    markDirty()
  })
})

onPlayerJoin(({ connection }) => {
  if (connection.bot) return
  if (!getHuman()) setHuman(connection.player)
  connection.player.seat({ hero: 'doorman', team: settings.team })
  // The hero can be in the world already (the spawn came before the join
  // finished): welcome now rather than waiting for a spawn that has passed.
  if (connection.player.pawn()) welcome(connection.player)
})

// First spawn of the session: build the hero, say hello, open the menu.
function welcome(player: Player): void {
  if (welcomed) return
  welcomed = true
  rebuildHuman(true)
  player.announce('Doorman Trainer', 'Type /dt for the menu')
  openMenu(player)
}

// "Leave testing" disconnects the player from this server. End whatever ran,
// take the mod's HUD off their screen (it would otherwise stay frozen in the
// hideout), and reset, so reconnecting opens the menu for a fresh session.
onPlayerLeave(({ connection }) => {
  const h = getHuman()
  if (h && connection.player.slot === h.slot) {
    stop()
    clearPlan()
    removeAll()
    resetUi(h)
    setHuman(undefined)
    welcomed = false
    log(`player left (${connection.name}); session reset`)
    flushSaves(true)
  }
})

let welcomed = false
onSpawn((player) => {
  let h = getHuman()
  // A human whose join event hasn't arrived yet still counts as the trainee.
  if (!h) {
    const c = connection(player)
    if (c && !c.bot) {
      setHuman(player)
      h = player
    }
  }
  if (h && player.slot === h.slot) {
    welcome(player)
    return
  }
  onBotSpawn(player)
  // Bots that respawn between tries wait frozen instead of roaming.
  const ph = currentPhase()
  if (ph === 'result' || ph === 'idle' || holdBot(player.slot)) player.freeze(true)
})

onInput(handleInput)
onAbilityCast(onCast)
// Invincible: every hit on the player is blocked (Settings → Build).
onDamage((hit) => {
  const h = getHuman()
  const pawn = h ? h.pawn() : undefined
  if (!pawn) return
  if (settings.invincible && hit.victim === pawn.entity) return { block: true }
  // Your own hits on the Mid-Boss don't count: you're holding it, not taking it.
  if (hit.attacker === pawn.entity && hit.victim === bossEntity()) return { block: true }
})
onLaunch(onProjectile)
onKill(onKillEvent)

onFrame((f) => {
  setNow(f.timeSeconds)
  keysFrame()
  frame()
  draw(false)
  flushSaves()
})
