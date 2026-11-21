import { type UiElement } from 'modlock'
import { settings } from './config'
import { doorEntities } from './doors'
import { currentPhase, currentRound } from './round'
import { isDebug, now } from './util'

// A live readout of what the kidnap tracker sees, shown with /debug on.
// It answers the open questions of the first test session at a glance:
// do door casts register, does the cart modifier show, how big are jumps.

function Line(props: { k: string; v: string; ok?: boolean }): UiElement {
  return (
    <panel style={{ flow: 'right', width: '100%' }}>
      <label style={{ color: '#a8a69e', fontSize: 13, width: 130 }}>{props.k}</label>
      <label style={{ color: props.ok === undefined ? '#f1efe8' : props.ok ? '#97c459' : '#f0997b', fontSize: 13 }}>{props.v}</label>
    </panel>
  )
}

export function DebugHud(): UiElement | null {
  if (!isDebug()) return null
  const r = currentRound()
  const t = r?.tracker
  const yes = (b: boolean) => (b ? 'yes' : 'no')
  return (
    <panel style={{ flow: 'down', width: 300, x: 16, y: '30%', padding: 10, background: '#000000b3', borderRadius: 8 }}>
      <label style={{ color: '#fac775', fontSize: 14, bold: true }}>Doorman Trainer debug</label>
      <Line k="phase" v={currentPhase()} />
      <Line k="doors open" v={String(doorEntities().length)} />
      {t ? (
        <panel style={{ flow: 'down', width: '100%' }}>
          <Line k="door casts" v={`setup ${t.doorCastsSetup} · fight ${t.doorCastsFight}`} ok={t.doorCastsSetup + t.doorCastsFight > 0} />
          <Line k="cart casts" v={String(t.cartCasts)} ok={t.cartCasts > 0} />
          <Line k="cart window" v={now() < t.cartUntil ? `${(t.cartUntil - now()).toFixed(1)}s` : 'closed'} />
          <Line k="cart modifier seen" v={yes(t.everCarted)} ok={t.everCarted} />
          <Line k="cart door jump" v={t.lastCartJump > 0 ? `${(now() - t.lastCartJump).toFixed(1)}s ago` : 'never'} ok={t.lastCartJump > 0} />
          <Line k="biggest jump" v={`${Math.round(t.maxJump)} u (need ${settings.jumpUnits})`} ok={t.maxJump > settings.jumpUnits} />
          <Line k="victim" v={r && r.victim >= 0 ? `slot ${r.victim}` : 'none'} ok={r !== undefined && r.victim >= 0} />
        </panel>
      ) : null}
      <label style={{ color: '#6f6d67', fontSize: 12 }}>Details in the modlock dev console</label>
    </panel>
  )
}
