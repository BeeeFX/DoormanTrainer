import { Buttons, watchInput, type Player } from 'modlock'
import { settings } from './config'
import { currentPhase, getHuman, hasLastPlan, isWaveBreak, next, resultAge, retry } from './round'
import { isMenuOpen, markDirty, openMenu } from './ui'
import { dbg, log, now } from './util'

// Quick controls, so tries chain without opening the menu:
//   Between rounds (result screen / idle): tap Reload = retry the same setup,
//     tap Jump = next setup (result screen only), tap Use = open the menu.
//   During a round: hold Reload = restart this setup, hold Use = skip to the
//     next one. Holding avoids firing them by accident mid-fight.
export const HOLD_SECONDS = 0.6
// Presses this soon after a try ends are leftovers from the fight, not choices.
export const RESULT_GUARD_SECONDS = 0.6

let reloadDown = -1
let useDown = -1
let fired = false

export function registerKeys(): void {
  if (!watchInput(Buttons.reload | Buttons.use | Buttons.jump)) log('watchInput refused: quick keys will not work')
}

function keyNames(bits: bigint): string {
  const out: string[] = []
  if ((bits & Buttons.reload) !== 0n) out.push('reload')
  if ((bits & Buttons.use) !== 0n) out.push('use')
  if ((bits & Buttons.jump) !== 0n) out.push('jump')
  return out.join('+')
}

function between(): boolean {
  const p = currentPhase()
  return p === 'result' || p === 'idle'
}

// Forget held keys: the menu swallows their releases.
export function resetKeys(): void {
  reloadDown = -1
  useDown = -1
  fired = true
}

export function handleInput(player: Player, pressed: bigint, released: bigint): void {
  const h = getHuman()
  if (!h || player.slot !== h.slot) return
  if (pressed !== 0n) dbg(`key down: ${keyNames(pressed)} in ${currentPhase()}`)
  // Releases always count, so a key let go while the menu was open is not
  // left "held" afterwards.
  if ((released & Buttons.reload) !== 0n) reloadDown = -1
  if ((released & Buttons.use) !== 0n) useDown = -1
  if (isMenuOpen()) return
  const t = now()
  // Between endless waves the next one starts by itself: keys wait.
  const ready = resultAge() >= RESULT_GUARD_SECONDS && !isWaveBreak()
  if ((pressed & Buttons.reload) !== 0n) {
    reloadDown = t
    fired = false
    // Only on the result screen: a habit reload while idle shouldn't start training.
    if (currentPhase() === 'result' && ready && (hasLastPlan() || settings.mode === 'endless')) {
      retry()
      fired = true
    }
  }
  if ((pressed & Buttons.use) !== 0n) {
    useDown = t
    fired = false
    if (between() && ready) {
      openMenu(player)
      fired = true
    }
  }
  if ((pressed & Buttons.jump) !== 0n && currentPhase() === 'result' && ready) next()
  markDirty()
}

// Fires the hold actions; called every frame.
export function keysFrame(): void {
  if (fired || isMenuOpen() || between()) return
  const t = now()
  if (reloadDown >= 0 && t - reloadDown >= HOLD_SECONDS) {
    fired = true
    reloadDown = -1
    log('held Reload: restarting this setup')
    retry()
  } else if (useDown >= 0 && t - useDown >= HOLD_SECONDS) {
    fired = true
    useDown = -1
    log('held Use: skipping to the next setup')
    next()
  }
}

// 0..1 while a hold is building up, for the HUD.
export function holdProgress(): { action: 'retry' | 'next'; value: number } | undefined {
  if (fired || between()) return undefined
  const t = now()
  if (reloadDown >= 0) return { action: 'retry', value: Math.min(1, (t - reloadDown) / HOLD_SECONDS) }
  if (useDown >= 0) return { action: 'next', value: Math.min(1, (t - useDown) / HOLD_SECONDS) }
  return undefined
}
