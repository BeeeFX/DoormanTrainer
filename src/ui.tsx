import { Banner, freeCursor, hide, item, Meter, Pips, show, Tag, Text, TopStrip, type Child, type Player, type Style, type UiElement } from 'modlock'
import { set } from 'modlock/console'
import { forceReroll, heroChoices, removeAll } from './bots'
import { BEHAVIOURS, BEHAVIOUR_TITLES, DIFFICULTY_TITLES, doorRangeUnits, practiceAids, resetSettings, ITEM_CHOICES, ITEM_PRESETS, VORTEX_WEB, saveSettings, settings, teamTitle, type Settings } from './config'
import { DebugHud } from './debughud'
import { bestFor as midbossBest, currentFight as currentMidbossFight } from './midboss'
import { bestFor, currentRun, KIDNAP_POINTS, outCount, resetBests } from './endless'
import { holdProgress, resetKeys } from './keys'
import { cooldownsFor, effective, isUnlocked, LEVELS, levelProgress, passProgress, passRuleText, resetProgress, type Level } from './levels'
import { allLocations, customTowers, generateBuiltins, saveCustom, selectionKey, type Location } from './locations'
import { clearPlan, enemiesInPit, lastMidbossResult, stop, currentBanner, currentPhase, currentRound, describeRound, getHuman, hasLastPlan, isWaveBreak, lastRun, lastResult, pause, rebuildHuman, retry, start, timeLeft } from './round'
import { rateText, resetStats, stats } from './stats'
import { isSuccess, OUTCOME_TITLES, type Outcome } from './tracker'
import { isDebug, now, onClockReset, setDebug } from './util'

type Tab = 'ladder' | 'endless' | 'midboss' | 'free' | 'build' | 'locations' | 'settings' | 'stats'
const TABS: readonly Tab[] = ['ladder', 'endless', 'midboss', 'free', 'build', 'locations', 'settings', 'stats']
const TAB_TITLES: Record<Tab, string> = { ladder: 'Ladder', endless: 'Endless', midboss: 'Mid-Boss', free: 'Practice', build: 'Build', locations: 'Locations', settings: 'Settings', stats: 'Stats' }

let menuOpen = false
let tab: Tab = 'ladder'
let viewLevel = 0 // ladder level shown in the detail panel; 0 = the selected one
let dirty = true
let lastDraw = -1

onClockReset(() => {
  lastDraw = -1
  dirty = true
})

export function markDirty(): void {
  dirty = true
}
export function isMenuOpen(): boolean {
  return menuOpen
}

export function openMenu(p: Player): void {
  pause()
  resetKeys()
  menuOpen = true
  tab = settings.mode === 'custom' ? 'free' : settings.mode === 'endless' ? 'endless' : settings.mode === 'midboss' ? 'midboss' : 'ladder'
  viewLevel = 0
  freeCursor(p, true)
  p.freeze(true)
  dirty = true
}

// The player left: drop the menu state and clear everything the mod shows them.
export function resetUi(p: Player): void {
  menuOpen = false
  resetKeys()
  hide(p)
  dirty = true
}

export function closeMenu(p: Player): void {
  resetKeys()
  menuOpen = false
  freeCursor(p, false)
  p.freeze(false)
  dirty = true
}

function changed(): void {
  saveSettings()
  dirty = true
}

function setting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings[key] = value
  changed()
}

// ---- look ----

const C = {
  backdrop: '#00000099',
  panel: '#15151af2',
  card: '#ffffff0f',
  cardHover: '#ffffff1f',
  line: '#ffffff22',
  text: '#f1efe8',
  muted: '#a8a69e',
  faint: '#6f6d67',
  amber: '#ef9f27',
  amberSoft: '#ef9f2733',
  amberText: '#fac775',
  green: '#7fb33a',
  red: '#e0603a',
}

const MENU_W = 1000
const BODY_H = 490

// ---- building blocks ----

// Splits a list into rows of `n`; the game's 'rightWrap' layout stacks
// wrapped rows on top of each other, so grids are built row by row.
function rows<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

// The shop's own item pictures (items/<slot>/<display name>), which look
// like the in-game shop. The item table's icons are older line drawings.
const ITEM_IMAGES: Record<string, string> = {
  upgrade_trophy_collector: 'vitality/trophy_collector',
  upgrade_tech_range: 'spirit/greater_expansion',
  upgrade_cheat_death: 'vitality/cheat_death',
  upgrade_aoe_root: 'spirit/vortex_web',
  upgrade_rapid_recharge: 'spirit/rapid_recharge',
  upgrade_imbued_duration_extender: 'spirit/superior_duration',
  upgrade_target_stun: 'spirit/knockdown',
  upgrade_targeted_silence: 'spirit/silence_glyph',
  upgrade_magic_slow: 'spirit/mystic_slow',
  upgrade_cold_front: 'spirit/cold_front',
  upgrade_ability_refresher: 'spirit/refresher',
  upgrade_ability_power_shard: 'spirit/echo_shard',
  upgrade_cooldown_reduction: 'spirit/superior_cooldown',
  upgrade_magic_reach: 'spirit/mystic_reach',
  upgrade_improved_spirit: 'spirit/extra_spirit',
  upgrade_magic_burst: 'spirit/mystic_burst',
  upgrade_improved_stamina: 'vitality/extra_stamina',
  upgrade_sprint_booster: 'vitality/sprint_boots',
  upgrade_warp_stone: 'vitality/warp_stone',
  upgrade_metal_skin: 'vitality/metal_skin',
}

function itemImage(name: string, fallback: string): string {
  const path = ITEM_IMAGES[name]
  return path ? `file://{images}/items/${path}.psd` : fallback
}

function Row(props: { children?: Child; style?: Style }): UiElement {
  return <panel style={{ flow: 'right', width: '100%', verticalAlign: 'center', ...props.style }}>{props.children}</panel>
}

function Col(props: { children?: Child; width?: Style['width']; style?: Style }): UiElement {
  return <panel style={{ flow: 'down', width: props.width ?? '100%', ...props.style }}>{props.children}</panel>
}

function T(props: { children?: Child; size?: number; color?: string; bold?: boolean; style?: Style }): UiElement {
  return <label style={{ color: props.color ?? C.text, fontSize: props.size ?? 16, bold: props.bold, ...props.style }}>{props.children}</label>
}

function Section(props: { title: string; children?: Child; style?: Style }): UiElement {
  return (
    <Col style={{ margin: [0, 0, 14, 0], ...props.style }}>
      <T size={13} color={C.muted} style={{ uppercase: true, letterSpacing: 1, margin: [0, 0, 6, 0] }}>{props.title}</T>
      {props.children}
    </Col>
  )
}

function Btn(props: { children?: Child; onPress?: (p: Player) => void; kind?: 'primary' | 'secondary' | 'quiet'; disabled?: boolean; style?: Style }): UiElement {
  const kind = props.kind ?? 'secondary'
  const bg = kind === 'primary' ? C.amber : kind === 'secondary' ? C.card : '#ffffff0a'
  const fg = kind === 'primary' ? '#2a1a02' : C.text
  return (
    <button
      disabled={props.disabled}
      onPress={props.onPress}
      sound="UI.MainMenu.Activate"
      hoverSound="UI.MainMenu.Hover"
      style={{ padding: [8, 16], borderRadius: 6, background: bg, borderWidth: kind === 'secondary' ? 1 : 0, borderColor: C.line, opacity: props.disabled ? 0.4 : 1, ...props.style }}
      hover={{ background: kind === 'primary' ? C.amberText : C.cardHover }}
    >
      <T size={15} color={fg} bold={kind === 'primary'}>{props.children}</T>
    </button>
  )
}

// A row of mutually exclusive choices.
function Segmented(props: { options: readonly string[]; selected: number; disabled?: boolean; onChange: (i: number) => void }): UiElement {
  return (
    <Row style={{ width: 'fit' }}>
      {props.options.map((o, i) => {
        const on = i === props.selected
        return (
          <button
            key={o}
            disabled={props.disabled}
            onPress={() => props.onChange(i)}
            hoverSound="UI.MainMenu.Hover"
            style={{ padding: [6, 12], margin: [0, 4, 0, 0], borderRadius: 6, background: on ? C.amberSoft : C.card, borderWidth: 1, borderColor: on ? C.amber : C.line, opacity: props.disabled ? 0.45 : 1 }}
            hover={{ background: on ? C.amberSoft : C.cardHover }}
          >
            <T size={14} color={on ? C.amberText : C.text}>{o}</T>
          </button>
        )
      })}
    </Row>
  )
}

// − value + for small whole numbers.
function Stepper(props: { title: string; value: number; min: number; max: number; step?: number; unit?: string; disabled?: boolean; onChange: (v: number) => void }): UiElement {
  const step = props.step ?? 1
  const put = (v: number) => props.onChange(Math.max(props.min, Math.min(props.max, v)))
  const box: Style = { width: 34, height: 34, borderRadius: 6, background: C.card, borderWidth: 1, borderColor: C.line }
  return (
    <Row style={{ margin: [0, 0, 8, 0] }}>
      <T size={15} color={props.disabled ? C.faint : C.text} style={{ width: 190 }}>{props.title}</T>
      <button disabled={props.disabled || props.value <= props.min} onPress={() => put(props.value - step)} style={box} hover={{ background: C.cardHover }}>
        <T size={18} style={{ horizontalAlign: 'center', verticalAlign: 'center' }}>−</T>
      </button>
      <T size={17} bold={true} color={props.disabled ? C.faint : C.amberText} style={{ width: 120, textAlign: 'center' }}>{`${props.value}${props.unit ?? ''}`}</T>
      <button disabled={props.disabled || props.value >= props.max} onPress={() => put(props.value + step)} style={box} hover={{ background: C.cardHover }}>
        <T size={18} style={{ horizontalAlign: 'center', verticalAlign: 'center' }}>+</T>
      </button>
    </Row>
  )
}

function Switch(props: { title: string; detail?: string; on: boolean; onChange: (on: boolean) => void }): UiElement {
  return (
    <button
      onPress={() => props.onChange(!props.on)}
      hoverSound="UI.MainMenu.Hover"
      style={{ flow: 'right', width: '100%', padding: [6, 8], margin: [0, 0, 4, 0], borderRadius: 6, verticalAlign: 'center', background: '#ffffff08' }}
      hover={{ background: C.card }}
    >
      <Col width="fill">
        <T size={15}>{props.title}</T>
        {props.detail ? <T size={12} color={C.muted}>{props.detail}</T> : null}
      </Col>
      <panel style={{ width: 52, height: 24, borderRadius: 12, background: props.on ? C.amber : '#ffffff22', verticalAlign: 'center' }}>
        <panel style={{ width: 18, height: 18, borderRadius: 9, background: props.on ? '#2a1a02' : C.muted, x: props.on ? 30 : 4, y: 3 }} />
      </panel>
    </button>
  )
}

// An on/off button for a small set of independent options.
function Chip(props: { title: string; on: boolean; onChange: (on: boolean) => void }): UiElement {
  return (
    <button
      onPress={() => props.onChange(!props.on)}
      hoverSound="UI.MainMenu.Hover"
      style={{ padding: [6, 12], margin: [0, 4, 0, 0], borderRadius: 6, background: props.on ? C.amberSoft : C.card, borderWidth: 1, borderColor: props.on ? C.amber : C.line }}
      hover={{ background: props.on ? C.amberSoft : C.cardHover }}
    >
      <T size={14} color={props.on ? C.amberText : C.text}>{`${props.on ? '✓ ' : ''}${props.title}`}</T>
    </button>
  )
}

function behaviourText(b: Settings['behaviour'], moves: Settings['moves']): string {
  const base = BEHAVIOUR_TITLES[BEHAVIOURS.indexOf(b)]
  const extra = [moves.jump ? 'jumps' : '', moves.slide ? 'slides' : '', moves.dash ? 'dashes' : ''].filter((x) => x)
  return extra.length > 0 ? `${base} · ${extra.join(', ')}` : base
}

// Per-mode switches: Luggage Cart and Vortex Web on a 3 s cooldown.
function VortexSwitch(props: { mode: 'ladder' | 'endless' | 'custom' | 'midboss' }): UiElement {
  return (
    <panel style={{ flow: 'down', width: '100%' }}>
    <Switch
      title="Short Luggage Cart cooldown"
      detail="Cart back in 3 s in this mode"
      on={settings.shortCart[props.mode]}
      onChange={(on) => {
        setting('shortCart', { ...settings.shortCart, [props.mode]: on })
        rebuildHuman(false)
      }}
    />
    <Switch
      title="Short Vortex Web cooldown"
      detail="Vortex Web back in 3 s in this mode"
      on={settings.shortVortex[props.mode]}
      onChange={(on) => {
        setting('shortVortex', { ...settings.shortVortex, [props.mode]: on })
        rebuildHuman(false)
      }}
    />
    </panel>
  )
}

function Labeled(props: { title: string; children?: Child }): UiElement {
  return (
    <Row style={{ margin: [0, 0, 8, 0] }}>
      <T size={15} style={{ width: 190 }}>{props.title}</T>
      {props.children}
    </Row>
  )
}

// ---- Ladder ----

function levelStatus(l: Level): { text: string; color: string } {
  const p = levelProgress(l.n)
  if (!isUnlocked(l.n)) return { text: 'Locked', color: C.faint }
  if (p.passed) return { text: 'Passed', color: C.green }
  if (l.window === 0) return { text: p.bestStreak > 0 ? `Best ${p.bestStreak}` : 'Endless', color: C.amberText }
  const c = passProgress(l, p)
  return { text: `${c.kidnaps}/${l.need}`, color: C.text }
}

function LadderTab(): UiElement {
  const shown = LEVELS[(viewLevel || settings.level) - 1] ?? LEVELS[0]
  const p = levelProgress(shown.n)
  const c = passProgress(shown, p)
  const unlocked = isUnlocked(shown.n)
  return (
    <Row style={{ verticalAlign: 'top' }}>
      <Col width={330} style={{ margin: [0, 20, 0, 0] }}>
        {LEVELS.map((l) => {
          const st = levelStatus(l)
          const on = l.n === shown.n
          return (
            <button
              key={l.n}
              onPress={() => {
                viewLevel = l.n
                if (isUnlocked(l.n)) {
                  settings.level = l.n
                  settings.mode = 'ladder'
                  changed()
                } else dirty = true
              }}
              hoverSound="UI.MainMenu.Hover"
              style={{ flow: 'right', width: '100%', padding: [7, 12], margin: [0, 0, 4, 0], borderRadius: 6, background: on ? C.amberSoft : C.card, borderWidth: 1, borderColor: on ? C.amber : '#00000001', verticalAlign: 'center' }}
              hover={{ background: on ? C.amberSoft : C.cardHover }}
            >
              <T size={18} bold={true} color={isUnlocked(l.n) ? C.amberText : C.faint} style={{ width: 30 }}>{String(l.n)}</T>
              <T size={16} color={isUnlocked(l.n) ? C.text : C.faint} style={{ width: 'fill' }}>{l.name}</T>
              <T size={13} color={st.color}>{st.text}</T>
            </button>
          )
        })}
      </Col>
      <Col width="fill" style={{ padding: 16, background: C.card, borderRadius: 8 }}>
        <T size={26} bold={true}>{`Level ${shown.n} · ${shown.name}`}</T>
        <T size={15} color={C.muted} style={{ margin: [2, 0, 14, 0] }}>{shown.blurb}</T>
        <Labeled title="Enemies"><T size={15} color={C.amberText}>{`${shown.enemies}${shown.allies ? ` vs you + ${shown.allies} allies` : ''}`}</T></Labeled>
        <Labeled title="Behaviour"><T size={15} color={C.amberText}>{behaviourText(shown.behaviour, shown.moves)}</T></Labeled>
        <Labeled title="Difficulty"><T size={15} color={C.amberText}>{DIFFICULTY_TITLES[shown.difficulty - 1]}</T></Labeled>
        <Labeled title="Fight spots"><T size={15} color={C.amberText}>{shown.spotFilter === 'close' ? 'Close to door 1' : shown.spotFilter === 'far' ? 'Far from door 1' : 'Any distance'}</T></Labeled>
        <Labeled title="Cooldowns"><T size={15} color={C.amberText}>{({ real: 'Real', short: '3 s', none: 'None' } as const)[cooldownsFor(shown.fastCooldowns)]}</T></Labeled>
        <Labeled title="To pass"><T size={15} color={C.amberText}>{passRuleText(shown)}</T></Labeled>
        {shown.window > 0 ? (
          <Row style={{ margin: [10, 0, 0, 0] }}>
            <Pips filled={Math.min(c.kidnaps, shown.need)} total={shown.need} tone={p.passed ? 'success' : 'gold'} />
            <T size={13} color={C.muted} style={{ margin: [0, 0, 0, 10] }}>{`last ${shown.window}: ${p.recent.slice(-shown.window).map((r) => (r === 'K' ? '★' : r === 'k' ? '●' : '·')).join(' ') || 'no tries yet'}`}</T>
          </Row>
        ) : null}
        {!unlocked ? <T size={15} color={C.red} style={{ margin: [12, 0, 0, 0] }}>{`Pass level ${shown.n - 1} to unlock this one.`}</T> : null}
        {p.passed ? <T size={15} color={C.green} style={{ margin: [12, 0, 0, 0] }}>{`Passed · ${p.kidnaps}/${p.attempts} overall · best streak ${p.bestStreak}`}</T> : null}
        <panel style={{ width: '100%', margin: [12, 0, 0, 0] }}>
          <VortexSwitch mode="ladder" />
        </panel>
      </Col>
    </Row>
  )
}

// ---- Endless ----

function EndlessTab(): UiElement {
  const run = lastRun()
  return (
    <Row style={{ verticalAlign: 'top' }}>
      <Col width={470} style={{ margin: [0, 30, 0, 0] }}>
        <Section title="Difficulty">
          <Segmented options={DIFFICULTY_TITLES} selected={settings.endlessDifficulty - 1} onChange={(i) => setting('endlessDifficulty', i + 1)} />
          <T size={12} color={C.muted} style={{ margin: [6, 0, 0, 0] }}>The starting bot difficulty. Bots get one step smarter every 6 waves, up to Hard.</T>
          <VortexSwitch mode="endless" />
        </Section>
        <Section title="How it works">
          <T size={14}>Each wave drops you at a fight spot with enemies. Kidnap every one of them through your doors before the clock runs out.</T>
          <T size={14} color={C.muted} style={{ margin: [6, 0, 0, 0] }}>Wave 1: 1 enemy. One more every 2 waves, up to 6. Less time each wave.</T>
          <T size={14} color={C.muted}>Every kidnap refreshes Cart, Bell and items; your doors stay up. Die or run out of time and the run is over.</T>
        </Section>
        <Section title="Points">
          <T size={14} color={C.muted}>{`Kidnap: ${KIDNAP_POINTS} +10% per wave · two from one cart: x2`}</T>
          <T size={14} color={C.muted}>Wave clear: 200 x wave + 10 per second left</T>
        </Section>
      </Col>
      <Col width="fill">
        <Section title="Best scores">
          {DIFFICULTY_TITLES.map((title, i) => {
            const b = bestFor(i + 1)
            const on = settings.endlessDifficulty === i + 1
            return (
              <Row key={title} style={{ padding: [8, 10], margin: [0, 0, 5, 0], borderRadius: 6, background: on ? C.amberSoft : C.card }}>
                <T size={16} color={on ? C.amberText : C.text} style={{ width: 'fill' }}>{title}</T>
                <T size={16} bold={true} color={b ? C.amberText : C.faint}>{b ? `${b.score}` : '–'}</T>
                <T size={13} color={C.muted} style={{ width: 120, textAlign: 'right' }}>{b ? `wave ${b.wave} · ${b.kidnaps} kidnaps` : 'no run yet'}</T>
              </Row>
            )
          })}
        </Section>
        {run ? (
          <Section title="Last run">
            <T size={16} color={run.best ? C.amberText : C.text}>{`${run.score} points · wave ${run.wave}${run.best ? ' · new best!' : ''}`}</T>
          </Section>
        ) : null}
        <Btn kind="quiet" onPress={() => { resetBests(); dirty = true }}>Reset best scores</Btn>
      </Col>
    </Row>
  )
}

// ---- Mid-Boss ----

function setMidboss<K extends keyof Settings['midboss']>(key: K, value: Settings['midboss'][K]): void {
  setting('midboss', { ...settings.midboss, [key]: value })
}

function MidbossTab(): UiElement {
  const m = settings.midboss
  const last = lastMidbossResult()
  return (
    <Row style={{ verticalAlign: 'top' }}>
      <Col width={500} style={{ margin: [0, 26, 0, 0] }}>
        <Section title="The fight">
          <Stepper title="Enemies in the pit" value={m.enemies} min={2} max={6} onChange={(v) => setMidboss('enemies', v)} />
          <Stepper title="Allies at door 1" value={m.allies} min={0} max={4} onChange={(v) => setMidboss('allies', v)} />
          <Labeled title="Difficulty">
            <Segmented options={DIFFICULTY_TITLES} selected={m.difficulty - 1} onChange={(i) => setMidboss('difficulty', i + 1)} />
          </Labeled>
          <Stepper title="Hold it for" value={m.duration} min={30} max={120} step={15} unit=" s" onChange={(v) => setMidboss('duration', v)} />
          <Stepper title="Enemy respawn" value={m.respawn} min={5} max={30} step={5} unit=" s" onChange={(v) => setMidboss('respawn', v)} />
          <VortexSwitch mode="midboss" />
        </Section>
      </Col>
      <Col width="fill">
        <Section title="How it works">
          <T size={14}>The enemies are taking the real Mid-Boss: they shoot it, and its health drains faster with every enemy in the pit. Get close to one and it turns on you.</T>
          <T size={14} color={C.muted} style={{ margin: [6, 0, 0, 0] }}>Place door 1 by your team, then kidnap enemies out of the pit. Your team finishes them, and they come back after their respawn time. Keep the Mid-Boss alive until the clock runs out.</T>
          <T size={14} color={C.muted} style={{ margin: [6, 0, 0, 0] }}>Points: 100 per kidnap, 10 per % of health left, 500 for holding it.</T>
        </Section>
        <Section title="Best scores">
          {DIFFICULTY_TITLES.map((title, i) => {
            const b = midbossBest(i + 1)
            const on = m.difficulty === i + 1
            return (
              <Row key={title} style={{ padding: [6, 10], margin: [0, 0, 4, 0], borderRadius: 6, background: on ? C.amberSoft : C.card }}>
                <T size={15} color={on ? C.amberText : C.text} style={{ width: 'fill' }}>{title}</T>
                <T size={15} bold={true} color={b ? C.amberText : C.faint}>{b ? `${b.score}` : '–'}</T>
                <T size={13} color={C.muted} style={{ width: 150, textAlign: 'right' }}>{b ? `${b.won ? 'held' : 'lost'} · ${b.kidnaps} kidnaps` : 'no fight yet'}</T>
              </Row>
            )
          })}
          {last ? <T size={14} color={last.won ? C.green : C.red} style={{ margin: [6, 0, 0, 0] }}>{`Last: ${last.won ? 'held' : 'lost'} · ${last.score} points${last.best ? ' · new best!' : ''}`}</T> : null}
        </Section>
      </Col>
    </Row>
  )
}

// ---- Free practice ----

interface Preset {
  name: string
  enemies: number
  allies: number
  behaviour: Settings['behaviour']
  difficulty: number
}
const PRESETS: readonly Preset[] = [
  { name: '1v1 still', enemies: 1, allies: 0, behaviour: 'still', difficulty: 1 },
  { name: '1v1 moving', enemies: 1, allies: 0, behaviour: 'walk', difficulty: 1 },
  { name: '1v1 duel', enemies: 1, allies: 0, behaviour: 'fight', difficulty: 2 },
  { name: '3v1', enemies: 3, allies: 0, behaviour: 'fight', difficulty: 2 },
  { name: '5v3 teamfight', enemies: 5, allies: 2, behaviour: 'fight', difficulty: 2 },
  { name: '6v1 chaos', enemies: 6, allies: 0, behaviour: 'fight', difficulty: 3 },
]

function FreeTab(): UiElement {
  const pool = heroChoices()
  const inPool = (name: string) => settings.heroPool.length === 0 || settings.heroPool.indexOf(name) >= 0
  return (
    <Col>
      <Row style={{ margin: [0, 0, 14, 0], width: 'fit' }}>
        <T size={14} color={C.muted} style={{ width: 80 }}>Presets</T>
        {PRESETS.map((p) => (
          <Btn
            key={p.name}
            style={{ margin: [0, 6, 0, 0], padding: [6, 12] }}
            onPress={() => {
              settings.enemies = p.enemies
              settings.allies = p.allies
              settings.behaviour = p.behaviour
              settings.difficulty = p.difficulty
              settings.mode = 'custom'
              changed()
            }}
          >
            {p.name}
          </Btn>
        ))}
      </Row>
      <Row style={{ verticalAlign: 'top' }}>
        <Col width={500} style={{ margin: [0, 24, 0, 0] }}>
          <Section title="Bots">
            <Stepper title="Enemies" value={settings.enemies} min={1} max={6} onChange={(v) => setting('enemies', v)} />
            <Stepper title="Allies" value={settings.allies} min={0} max={5} onChange={(v) => setting('allies', v)} />
            <Labeled title="Behaviour">
              <Segmented options={['Still', 'Walk', 'Full AI']} selected={BEHAVIOURS.indexOf(settings.behaviour)} onChange={(i) => setting('behaviour', BEHAVIOURS[i])} />
            </Labeled>
            {settings.behaviour === 'walk' ? (
              <Labeled title="Walk with">
                <Chip title="Jump" on={settings.moves.jump} onChange={(on) => setting('moves', { ...settings.moves, jump: on })} />
                <Chip title="Slide" on={settings.moves.slide} onChange={(on) => setting('moves', { ...settings.moves, slide: on })} />
                <Chip title="Dash" on={settings.moves.dash} onChange={(on) => setting('moves', { ...settings.moves, dash: on })} />
              </Labeled>
            ) : null}
            <Labeled title="Difficulty">
              <Segmented options={DIFFICULTY_TITLES} selected={settings.difficulty - 1} onChange={(i) => setting('difficulty', i + 1)} />
            </Labeled>
          </Section>
          <Section title="Round">
            <Labeled title="Fight spot distance">
              <Segmented options={['Any', 'Close', 'Far']} selected={['any', 'close', 'far'].indexOf(settings.spotFilter)} onChange={(i) => setting('spotFilter', (['any', 'close', 'far'] as const)[i])} />
            </Labeled>
            <VortexSwitch mode="custom" />
          </Section>
        </Col>
        <Col width="fill">
          <Section title={`Enemy heroes · ${settings.heroPool.length === 0 ? 'all' : `${settings.heroPool.length} picked`}`}>
            <panel style={{ flow: 'down', width: '100%', height: 250, overflow: 'scroll' }}>
              {rows(pool, 7).map((row, ri) => (
              <panel key={ri} style={{ flow: 'right', width: 'fit', height: 57 }}>
              {row.map((h) => (
                <button
                  key={h.name}
                  tooltip={h.title}
                  hoverSound="UI.MainMenu.Hover"
                  style={{ width: 52, height: 52, margin: [0, 5, 5, 0], borderRadius: 6, borderWidth: 2, borderColor: inPool(h.name) ? C.amber : '#00000001', opacity: inPool(h.name) ? 1 : 0.3 }}
                  onPress={() => {
                    let list = settings.heroPool.length === 0 ? pool.map((x) => x.name) : settings.heroPool.slice()
                    if (list.indexOf(h.name) >= 0) list = list.filter((n) => n !== h.name)
                    else list.push(h.name)
                    settings.heroPool = list.length === pool.length || list.length === 0 ? [] : list
                    forceReroll()
                    changed()
                  }}
                >
                  <hero hero={h.id} look="small" scaling="cover" style={{ width: '100%', height: '100%' }} />
                </button>
              ))}
              </panel>
              ))}
            </panel>
            <Row style={{ margin: [8, 0, 8, 0] }}>
              <Btn kind="quiet" onPress={() => { settings.heroPool = []; forceReroll(); changed() }}>All heroes</Btn>
              <Btn kind="quiet" onPress={() => { forceReroll(); dirty = true }}>Shuffle now</Btn>
            </Row>
            <Stepper title="New heroes every" value={settings.rerollEvery} min={0} max={20} unit={settings.rerollEvery === 0 ? ' (never)' : ' rounds'} onChange={(v) => setting('rerollEvery', v)} />
          </Section>
        </Col>
      </Row>
    </Col>
  )
}

// ---- Locations ----

function toggleLocation(l: Location, on: boolean): void {
  const all = allLocations(settings.team).map(selectionKey)
  let chosen = settings.locations.length === 0 ? all.slice() : settings.locations.slice()
  const key = selectionKey(l)
  chosen = chosen.filter((k) => k !== key)
  if (on) chosen.push(key)
  if (chosen.length === 0) return // keep at least one
  settings.locations = all.every((k) => chosen.indexOf(k) >= 0) ? [] : chosen
  changed()
}

const KIND_TITLES: Record<string, string> = { guardian: 'Guardian', walker: 'Walker', midboss: 'Mid-Boss', custom: 'Custom' }

function LocationsTab(): UiElement {
  const list = allLocations(settings.team)
  const isOn = (l: Location) => settings.locations.length === 0 || settings.locations.indexOf(selectionKey(l)) >= 0
  const count = list.filter(isOn).length
  const towers = customTowers()
  const last = towers[towers.length - 1]
  return (
    <Col>
      <Row style={{ margin: [0, 0, 8, 0] }}>
        <T size={14} color={C.muted} style={{ width: 'fill' }}>{`${teamTitle(settings.team)} side · ${count} of ${list.length} selected · each round picks a random fight spot from them`}</T>
        {settings.hiddenSpots.length > 0 ? (
          <Btn kind="quiet" style={{ margin: [0, 8, 0, 0] }} onPress={() => setting('hiddenSpots', [])}>{`Restore ${settings.hiddenSpots.length} hidden spot${settings.hiddenSpots.length > 1 ? 's' : ''}`}</Btn>
        ) : null}
        <Btn kind="quiet" onPress={() => setting('locations', [])}>Select all</Btn>
      </Row>
      <panel style={{ flow: 'down', width: '100%', height: 300, overflow: 'scroll' }}>
        {list.length === 0 ? <T color={C.muted}>No locations on this map yet. Record your own below.</T> : null}
        {list.map((l) => {
          const on = isOn(l)
          return (
            <Row key={l.id} style={{ padding: [4, 8], margin: [0, 0, 4, 0], background: on ? C.card : '#00000001', borderRadius: 6 }}>
              <button onPress={() => toggleLocation(l, !on)} style={{ flow: 'right', width: 'fill', verticalAlign: 'center', padding: [4, 0], background: '#00000001' }} hover={{ background: '#ffffff0a' }}>
                <panel style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: on ? C.amber : C.muted, background: on ? C.amber : '#00000001', margin: [0, 12, 0, 0] }} />
                <T size={16} color={on ? C.text : C.muted} style={{ width: 'fill' }}>{l.name}</T>
              </button>
              <Tag tone={l.kind === 'midboss' ? 'gold' : l.kind === 'custom' ? 'accent' : 'muted'}>{KIND_TITLES[l.kind]}</Tag>
              <T size={13} color={C.muted} style={{ width: 150, textAlign: 'right' }}>{`${l.fights.length} spots · ${rateText(stats.byLocation[selectionKey(l)])}`}</T>
              <Btn
                kind="quiet"
                style={{ margin: [0, 0, 0, 8], padding: [4, 10] }}
                onPress={() => {
                  settings.locations = [selectionKey(l)]
                  changed()
                }}
              >
                Only
              </Btn>
              <Btn
                kind="quiet"
                style={{ margin: [0, 0, 0, 6], padding: [4, 10] }}
                onPress={(p) => {
                  // Look at the spot: stand at door 1's spot with the menu closed.
                  closeMenu(p)
                  stop()
                  p.teleport({ x: l.anchor.pos.x, y: l.anchor.pos.y, z: l.anchor.pos.z + 20 }, l.anchor.facing, { x: 0, y: 0, z: 0 })
                }}
              >
                Go
              </Btn>
            </Row>
          )
        })}
      </panel>
      <Section title="Record your own" style={{ margin: [12, 0, 0, 0] }}>
        <T size={13} color={C.muted} style={{ margin: [0, 0, 8, 0] }}>Stand where door 1 goes and record an anchor. Then walk to each fight spot, face where the enemies should come from, and record it.</T>
        <Row>
          <Btn
            onPress={(p) => {
              const pawn = p.pawn()
              if (!pawn) return
              towers.push({ name: `spot-${towers.length + 1}`, team: settings.team, pos: pawn.position, facing: { pitch: 0, yaw: pawn.eyeAngles.yaw, roll: 0 }, fights: [] })
              saveCustom()
              dirty = true
            }}
          >
            Record anchor here
          </Btn>
          <Btn
            style={{ margin: [0, 0, 0, 8] }}
            disabled={!last}
            onPress={(p) => {
              const pawn = p.pawn()
              if (!pawn || !last) return
              last.fights.push({ pos: pawn.position, facing: { pitch: 0, yaw: pawn.eyeAngles.yaw, roll: 0 } })
              saveCustom()
              dirty = true
            }}
          >
            Record fight spot here
          </Btn>
          <Btn
            kind="quiet"
            style={{ margin: [0, 0, 0, 8] }}
            disabled={!last}
            onPress={() => {
              if (!last) return
              if (last.fights.length > 0) last.fights.pop()
              else towers.pop()
              saveCustom()
              dirty = true
            }}
          >
            Undo last
          </Btn>
          <T size={13} color={C.muted} style={{ margin: [0, 0, 0, 12] }}>{last ? `${last.name}: ${last.fights.length} fight spots` : 'Nothing recorded yet'}</T>
        </Row>
      </Section>
    </Col>
  )
}

// ---- Build (your hero) ----

function setItems(list: string[]): void {
  setting('items', list)
  rebuildHuman(false)
}

function BuildTab(): UiElement {
  const owned = (name: string) => settings.items.indexOf(name) >= 0
  const preset = ITEM_PRESETS.findIndex((p) => p.items.length === settings.items.length && p.items.every(owned))
  return (
    <Col>
      <Row style={{ verticalAlign: 'top' }}>
        <Col width={470} style={{ margin: [0, 30, 0, 0] }}>
          <Section title="Level">
            <Stepper title="Souls (build level)" value={settings.souls} min={0} max={50000} step={2500} onChange={(v) => { setting('souls', v); rebuildHuman(false) }} />
            <T size={12} color={C.muted}>Sets your ability points. Bots get the same level.</T>
          </Section>
        </Col>
        <Col width="fill">
          <Section title="Abilities">
            <Switch title="Max all abilities" detail={settings.maxAbilities ? 'Every ability at tier 3, bots too' : 'Upgrades follow the souls: Doorway first, then Cart'} on={settings.maxAbilities} onChange={(on) => { setting('maxAbilities', on); rebuildHuman(false) }} />
            <Switch title="Doorway range upgrade" detail={`+40 m door distance · range now ${Math.round(doorRangeUnits())} units`} on={settings.rangeUpgrade} onChange={(on) => { setting('rangeUpgrade', on); generateBuiltins(); clearPlan() }} />
            <Labeled title="Cooldowns">
              <Segmented options={['Real', 'Short 3 s', 'None']} selected={['real', 'short', 'none'].indexOf(settings.cooldowns)} onChange={(i) => { setting('cooldowns', (['real', 'short', 'none'] as const)[i]); rebuildHuman(false) }} />
            </Labeled>
            <Switch title="Invincible" detail="Damage to you is blocked" on={settings.invincible} onChange={(on) => setting('invincible', on)} />
            {practiceAids() ? <T size={12} color={C.amberText}>Practice aids on (short or no cooldowns, short Cart or Vortex Web, Invincible): ladder progress and endless best scores aren't saved.</T> : null}
          </Section>
        </Col>
      </Row>
      <Section title={`Starting items · ${settings.items.length} · given free, souls stay for abilities`}>
        <Row style={{ margin: [0, 0, 10, 0] }}>
          <Segmented options={ITEM_PRESETS.map((p) => p.name)} selected={preset} onChange={(i) => setItems(ITEM_PRESETS[i].items.slice())} />
          <T size={13} color={C.muted} style={{ margin: [0, 0, 0, 14] }}>Click to add or remove · hover for the shop card</T>
        </Row>
        <panel style={{ flow: 'down', width: '100%' }}>
          {rows(ITEM_CHOICES.filter((n) => item(n) !== undefined), 11).map((row, ri) => (
          <panel key={ri} style={{ flow: 'right', width: 'fit', height: 72 }}>
          {row.map((name) => {
            const it = item(name)
            if (!it) return null
            const on = owned(name)
            return (
              <button
                key={name}
                item={name}
                hoverSound="UI.MainMenu.Hover"
                onPress={() => setItems(on ? settings.items.filter((n) => n !== name) : settings.items.concat([name]))}
                style={{ width: 64, height: 64, margin: [0, 8, 8, 0], padding: 2, borderRadius: 8, borderWidth: 3, borderColor: on ? C.amber : '#00000001', background: on ? C.amberSoft : C.card, opacity: on ? 1 : 0.45 }}
              >
                <image src={itemImage(name, it.icon)} scaling="cover" style={{ width: '100%', height: '100%', borderRadius: 6 }} />
              </button>
            )
          })}
          </panel>
          ))}
        </panel>
        <T size={12} color={C.muted}>{owned(VORTEX_WEB) ? 'Vortex Web sits on your item keys.' : 'Vortex Web is off: add it back with the Doorman build preset.'}</T>
      </Section>
    </Col>
  )
}

// ---- Settings ----

function SettingsTab(): UiElement {
  return (
    <Row style={{ verticalAlign: 'top' }}>
      <Col width={470} style={{ margin: [0, 30, 0, 0] }}>
        <Section title="Between tries">
          <Switch title="Continue automatically" detail="Off: the result screen waits for Retry or Next" on={settings.autoNext} onChange={(on) => setting('autoNext', on)} />
          <Stepper title="Result screen" value={settings.resultSec} min={1} max={10} unit=" s" disabled={!settings.autoNext} onChange={(v) => setting('resultSec', v)} />
          <Switch title="Move up when you pass a ladder level" detail="Off: stay on the level until you pick the next one" on={settings.autoAdvance} onChange={(on) => setting('autoAdvance', on)} />
          <Labeled title="After a miss">
            <Segmented options={['Next setup', 'Retry same']} selected={settings.afterMiss === 'retry' ? 1 : 0} disabled={!settings.autoNext} onChange={(i) => setting('afterMiss', i === 1 ? 'retry' : 'next')} />
          </Labeled>
        </Section>
        <Section title="Timing (Ladder and Practice)">
          <Stepper title="Fight time" value={settings.fightSec} min={10} max={90} step={5} unit=" s" onChange={(v) => setting('fightSec', v)} />
          <Switch title="Re-place door 1 if your doors close" detail="Back to door 1's spot, then back where you were; the clock pauses" on={settings.redoor} onChange={(on) => setting('redoor', on)} />
          <Stepper title="Watch after kidnap" value={settings.followSec} min={0} max={5} step={0.5} unit=" s" onChange={(v) => setting('followSec', v)} />
        </Section>
      </Col>
      <Col width="fill">
        <Section title="Side">
          <Segmented
            options={[teamTitle(2), teamTitle(3)]}
            selected={settings.team === 3 ? 1 : 0}
            onChange={(i) => {
              const team = i === 1 ? 3 : 2
              if (team === settings.team) return
              setting('team', team)
              removeAll()
              clearPlan()
              const h = getHuman()
              if (h) {
                h.seat({ hero: 'doorman', team })
                rebuildHuman(true)
              }
            }}
          />
        </Section>
        <Section title="World">
          <Switch title="Troopers in lanes" detail="More realistic, more clutter" on={settings.troopers} onChange={(on) => { setting('troopers', on); set('citadel_trooper_spawn_enabled', on) }} />
          <Labeled title="Kidnap detection">
            <Segmented options={['Track cart', 'Radius']} selected={settings.detect === 'radius' ? 1 : 0} onChange={(i) => setting('detect', i === 1 ? 'radius' : 'track')} />
          </Labeled>
          <Labeled title="Full-AI bots">
            <Segmented options={['Trainer', "Game's own"]} selected={settings.botAi === 'game' ? 1 : 0} onChange={(i) => setting('botAi', i === 1 ? 'game' : 'trainer')} />
          </Labeled>
          <Btn kind="quiet" style={{ margin: [6, 0, 0, 0] }} onPress={() => { resetSettings(); set('citadel_trooper_spawn_enabled', settings.troopers); generateBuiltins(); clearPlan(); rebuildHuman(true); dirty = true }}>Reset settings to defaults</Btn>
          <Switch title="Debug overlay" detail="Live tracker readout, for the first test session" on={isDebug()} onChange={(on) => { setDebug(on); dirty = true }} />
        </Section>
      </Col>
    </Row>
  )
}

// ---- Stats ----

function StatsTab(): UiElement {
  const misses = Object.keys(stats.misses)
    .map((k) => ({ k, n: stats.misses[k] }))
    .sort((a, b) => b.n - a.n)
  const missTotal = misses.reduce((s, m) => s + m.n, 0)
  const tile = (title: string, value: string) => (
    <Col width={172} style={{ padding: 12, margin: [0, 10, 10, 0], background: C.card, borderRadius: 8 }}>
      <T size={13} color={C.muted}>{title}</T>
      <T size={28} bold={true}>{value}</T>
    </Col>
  )
  const rate = stats.attempts > 0 ? Math.round((stats.kidnaps / stats.attempts) * 100) : 0
  const locs = allLocations(settings.team)
    .map((l) => ({ name: l.name, r: stats.byLocation[selectionKey(l)] }))
    .filter((x) => x.r !== undefined && x.r.attempts > 0)
    .sort((a, b) => b.r.attempts - a.r.attempts)
    .slice(0, 6)
  return (
    <Col>
      <Row style={{ width: 'fit' }}>
        {tile('Attempts', String(stats.attempts))}
        {tile('Kidnaps', `${stats.kidnaps} · ${rate}%`)}
        {tile('Streak / best', `${stats.streak} / ${stats.bestStreak}`)}
        {tile('Door 2 → cart', stats.timedKidnaps > 0 ? `${(stats.cartTime - stats.door2Time).toFixed(1)} s` : '–')}
      </Row>
      <Row style={{ verticalAlign: 'top' }}>
        <Col width={480} style={{ margin: [0, 24, 0, 0] }}>
          <Section title="Why you missed">
            {misses.length === 0 ? <T size={14} color={C.muted}>No misses yet.</T> : null}
            {misses.map((m) => (
              <Row key={m.k} style={{ margin: [0, 0, 6, 0] }}>
                <T size={14} style={{ width: 240 }}>{OUTCOME_TITLES[m.k as Outcome] ?? m.k}</T>
                <Meter value={missTotal > 0 ? m.n / missTotal : 0} tone="danger" width={170} />
                <T size={13} color={C.muted} style={{ margin: [0, 0, 0, 10] }}>{String(m.n)}</T>
              </Row>
            ))}
          </Section>
        </Col>
        <Col width="fill">
          <Section title="By location">
            {locs.length === 0 ? <T size={14} color={C.muted}>Play a few rounds first.</T> : null}
            {locs.map((x) => (
              <Row key={x.name} style={{ margin: [0, 0, 6, 0] }}>
                <T size={14} style={{ width: 'fill' }}>{x.name}</T>
                <T size={14} color={C.amberText}>{`${x.r.kidnaps}/${x.r.attempts}`}</T>
              </Row>
            ))}
          </Section>
        </Col>
      </Row>
      <Row style={{ margin: [6, 0, 0, 0] }}>
        <Btn kind="quiet" onPress={() => { resetStats(); dirty = true }}>Reset stats</Btn>
        <Btn kind="quiet" onPress={() => { resetProgress(); settings.level = 1; viewLevel = 0; changed() }}>Reset ladder progress</Btn>
      </Row>
    </Col>
  )
}

// ---- menu frame ----

function startLabel(): { label: string; disabled: boolean; mode: Settings['mode'] } {
  if (tab === 'ladder') {
    const l = LEVELS[(viewLevel || settings.level) - 1] ?? LEVELS[0]
    return { label: `Start level ${l.n} · ${l.name}`, disabled: !isUnlocked(l.n), mode: 'ladder' }
  }
  if (tab === 'free') return { label: 'Start practice', disabled: false, mode: 'custom' }
  if (tab === 'endless') return { label: `Start endless · ${DIFFICULTY_TITLES[settings.endlessDifficulty - 1]}`, disabled: false, mode: 'endless' }
  if (tab === 'midboss') return { label: `Start Mid-Boss fight · ${DIFFICULTY_TITLES[settings.midboss.difficulty - 1]}`, disabled: false, mode: 'midboss' }
  return { label: `Start · ${effective().label}`, disabled: false, mode: settings.mode }
}

function Menu(): UiElement {
  const body = tab === 'ladder' ? LadderTab() : tab === 'endless' ? EndlessTab() : tab === 'midboss' ? MidbossTab() : tab === 'free' ? FreeTab() : tab === 'build' ? BuildTab() : tab === 'locations' ? LocationsTab() : tab === 'settings' ? SettingsTab() : StatsTab()
  const s = startLabel()
  return (
    <panel style={{ width: '100%', height: '100%', background: C.backdrop }}>
      <panel style={{ flow: 'down', width: MENU_W, horizontalAlign: 'center', verticalAlign: 'center', background: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
        <Row style={{ padding: [16, 22, 0, 22] }}>
          <T size={26} bold={true} style={{ width: 'fill' }}>Doorman Trainer</T>
          <Tag tone={settings.mode === 'custom' ? 'accent' : 'gold'}>{settings.mode === 'ladder' ? `Ladder · level ${settings.level}` : settings.mode === 'endless' ? `Endless · ${DIFFICULTY_TITLES[settings.endlessDifficulty - 1]}` : settings.mode === 'midboss' ? `Mid-Boss · ${DIFFICULTY_TITLES[settings.midboss.difficulty - 1]}` : 'Practice'}</Tag>
        </Row>
        <Row style={{ padding: [12, 22, 0, 22], margin: [0, 0, 14, 0], width: 'fit' }}>
          {TABS.map((t) => {
            const on = tab === t
            return (
              <button
                key={t}
                onPress={() => {
                  tab = t
                  viewLevel = 0
                  dirty = true
                }}
                hoverSound="UI.MainMenu.Hover"
                style={{ padding: [7, 12], margin: [0, 3, 0, 0], borderRadius: 6, background: on ? C.amberSoft : '#ffffff08', borderWidth: 1, borderColor: on ? C.amber : '#00000001' }}
                hover={{ background: on ? C.amberSoft : C.cardHover }}
              >
                <T size={15} color={on ? C.amberText : C.text} bold={on}>{TAB_TITLES[t]}</T>
              </button>
            )
          })}
        </Row>
        <panel style={{ flow: 'down', width: '100%', height: BODY_H, padding: [0, 22], overflow: 'clip' }}>{body}</panel>
        <Row style={{ padding: [14, 22], background: '#00000040', borderRadius: 12 }}>
          <Btn
            kind="primary"
            disabled={s.disabled}
            onPress={(p) => {
              settings.mode = s.mode
              changed()
              closeMenu(p)
              start()
            }}
          >
            {s.label}
          </Btn>
          {hasLastPlan() && settings.mode !== 'endless' ? (
            <Btn
              style={{ margin: [0, 0, 0, 8] }}
              onPress={(p) => {
                closeMenu(p)
                retry()
              }}
            >
              Retry last setup
            </Btn>
          ) : null}
          <Btn kind="quiet" style={{ margin: [0, 0, 0, 8] }} onPress={(p) => closeMenu(p)}>
            Close
          </Btn>
          <T size={13} color={C.muted} style={{ width: 'fill', textAlign: 'right' }}>In game: Reload retry · Jump next · Use menu</T>
        </Row>
      </panel>
    </panel>
  )
}

// ---- HUD ----

const PHASE_TITLES: Record<string, string> = { idle: 'Ready', setup: 'Place door 1', fight: 'Fight', follow: 'Kidnapped!', result: 'Result' }

function KeyHint(props: { k: string; label: string }): UiElement {
  return (
    <Row style={{ width: 'fit', margin: [0, 14, 0, 0] }}>
      <panel style={{ padding: [3, 9], borderRadius: 4, background: '#ffffffd9', margin: [0, 6, 0, 0] }}>
        <T size={14} bold={true} color="#15151a">{props.k}</T>
      </panel>
      <T size={15} style={{ shadow: true }}>{props.label}</T>
    </Row>
  )
}

function Hud(): UiElement {
  const phase = currentPhase()
  const r = currentRound()
  const b = currentBanner()
  const left = timeLeft()
  const eff = effective()
  const run = settings.mode === 'endless' ? currentRun() : undefined
  const mb = settings.mode === 'midboss' ? currentMidbossFight() : undefined
  const over = settings.mode === 'endless' && !run && phase === 'result' ? lastRun() : undefined
  const heading = mb ? `Mid-Boss · ${Math.ceil(mb.hp)}% · ${PHASE_TITLES[phase]}` : over ? `Endless · game over · wave ${over.wave}` : phase === 'result' && run && isWaveBreak() ? `Endless · wave ${run.wave - 1} cleared` : phase === 'idle' ? `Doorman Trainer · ${eff.label}` : run ? `Endless · wave ${run.wave} · ${PHASE_TITLES[phase]}` : `${PHASE_TITLES[phase]} · ${describeRound()}`
  const clock = Number.isFinite(left) ? `${Math.ceil(left)}s · ` : ''
  const aids = practiceAids() ? [settings.invincible ? 'invincible' : '', settings.cooldowns === 'none' ? 'no cooldowns' : settings.cooldowns === 'short' ? 'short cooldowns' : '', settings.shortVortex[settings.mode] ? 'short Vortex Web' : '', settings.shortCart[settings.mode] ? 'short Cart' : ''].filter((x) => x).join(', ') : ''
  const line = mb ? `${clock}kidnaps ${mb.kidnaps} · ${enemiesInPit()} in the pit` : over ? `${over.score} points${over.best ? ' · new best!' : ''}` : run && isWaveBreak() ? `score ${run.score} · next wave starting` : phase === 'idle' ? `Press E or type /dt for the menu${aids ? ` · practice aids: ${aids}, not saved` : ''}` : run ? `${clock}score ${run.score} · ${outCount(run)}/${eff.enemies} out` : `${clock}kidnaps ${stats.kidnaps}/${stats.attempts} · streak ${stats.streak}`
  const level = settings.mode === 'ladder' ? LEVELS[settings.level - 1] : undefined
  const lp = level ? passProgress(level, levelProgress(level.n)) : undefined
  const hold = holdProgress()
  const res = lastResult()
  return (
    <panel style={{ width: '100%', height: '100%' }}>
      <DebugHud />
      <TopStrip heading={heading} line={line} keepTeamBar={true}>
        {run ? <Pips filled={outCount(run)} total={eff.enemies} tone="gold" /> : level && lp && level.window > 0 ? <Pips filled={Math.min(lp.kidnaps, level.need)} total={level.need} tone="gold" /> : <Tag tone="accent">{eff.label}</Tag>}
      </TopStrip>
      {mb ? (
        <Col width={440} style={{ horizontalAlign: 'center', y: '13%' }}>
          <Meter value={mb.hp / 100} tone={mb.hp > 35 ? 'amber' : 'danger'} width={440} height={12} style={{ horizontalAlign: 'center' }} />
          <T size={13} style={{ horizontalAlign: 'center', shadow: true, margin: [4, 0, 0, 0] }}>{`Mid-Boss ${Math.ceil(mb.hp)}%`}</T>
        </Col>
      ) : null}
      {phase === 'setup' && r ? (
        <Col width={520} style={{ horizontalAlign: 'center', y: '30%' }}>
          <Text role="title" style={{ horizontalAlign: 'center' }}>{r.doorPlacedAt >= 0 ? 'Door placed · go!' : r.redoor ? 'Doors closed · place door 1 again' : 'Place your first door'}</Text>
          <Text role="body" tone="muted" style={{ horizontalAlign: 'center' }}>{r.doorPlacedAt >= 0 ? 'Teleporting to the fight' : 'Doorway is ability 2 · the fight starts as soon as it is down'}</Text>
        </Col>
      ) : null}
      {b ? (
        <panel style={{ horizontalAlign: 'center', y: '26%', width: 900 }}>
          <Banner title={b.title} detail={b.detail} tone={b.tone} />
        </panel>
      ) : null}
      {phase === 'result' && !isWaveBreak() && settings.mode === 'endless' ? (
        <Col width="fit" style={{ horizontalAlign: 'center', y: '58%' }}>
          <Row style={{ width: 'fit', horizontalAlign: 'center' }}>
            <KeyHint k="R" label="New run" />
            <KeyHint k="Jump" label="New run" />
            <KeyHint k="Use" label="Menu" />
          </Row>
        </Col>
      ) : null}
      {phase === 'result' && settings.mode !== 'endless' ? (
        <Col width="fit" style={{ horizontalAlign: 'center', y: '58%' }}>
          <Row style={{ width: 'fit', horizontalAlign: 'center' }}>
            <KeyHint k="R" label={res && !isSuccess(res) ? 'Retry this one' : 'Same setup again'} />
            <KeyHint k="Jump" label="Next setup" />
            <KeyHint k="Use" label="Menu" />
          </Row>
          {Number.isFinite(left) ? <T size={14} color={C.muted} style={{ horizontalAlign: 'center', margin: [8, 0, 0, 0], shadow: true }}>{`${settings.afterMiss === 'retry' && res && !isSuccess(res) ? 'Retrying' : 'Next'} in ${Math.ceil(left)}s`}</T> : null}
        </Col>
      ) : null}
      {phase === 'setup' || phase === 'fight' || phase === 'follow' ? (
        <Col width="fit" style={{ horizontalAlign: 'center', verticalAlign: 'bottom', margin: [0, 0, 150, 0] }}>
          {hold ? (
            <Col width="fit" style={{ horizontalAlign: 'center' }}>
              <T size={15} bold={true} style={{ horizontalAlign: 'center', shadow: true }}>{hold.action === 'retry' ? 'Restarting this setup…' : 'Skipping to the next…'}</T>
              <Meter value={hold.value} tone="amber" width={220} style={{ horizontalAlign: 'center', margin: [4, 0, 0, 0] }} />
            </Col>
          ) : (
            <T size={13} color="#ffffffaa" style={{ horizontalAlign: 'center', shadow: true }}>{settings.mode === 'endless' ? 'Hold R or Use: abandon this run and start a new one' : 'Hold R: restart · Hold Use: skip'}</T>
          )}
        </Col>
      ) : null}
    </panel>
  )
}

// ---- drawing ----

export function draw(force: boolean): void {
  const p = getHuman()
  if (!p) return
  const t = now()
  const active = currentPhase() !== 'idle' || currentBanner() !== undefined || holdProgress() !== undefined || isDebug()
  // Redraw on change, and 5 times a second while something counts down.
  if (!force && !dirty && !(active && t - lastDraw >= 0.2)) return
  dirty = false
  lastDraw = t
  show(p, menuOpen ? Menu() : Hud())
}
