# Developing Doorman Trainer

Doorman Trainer is a [Modlock](https://github.com/paralin/modlock) mod (v0.1.97) written in TypeScript. Modlock runs it in a WebAssembly sandbox on a local Deadlock server and launches the game into that server.

## Run it from source

You need Windows, Deadlock on Steam and Node.js 22 or newer.

```powershell
npm install
npx modlock dev
```

`modlock dev` builds the mod, starts a local server on `dl_midtown`, launches Deadlock through Steam and joins it. Every save rebuilds the mod and swaps in the new build without restarting. The menu opens when you spawn.

Run only one `modlock dev` at a time. A second one can't open the menu port (4320), and its first lines say `✗ mod interfaces are off`. If you see that, stop every `modlock dev` and start one again.

| Command | Does |
|---|---|
| `npm test` | Logic tests: kidnap detection, miss reasons, ladder rules, endless and Mid-Boss scoring, hero build, the fighter's maths. No game needed |
| `npm run check` | Type-check |
| `npx modlock build` | Check and build the mod into `build/` |
| `npx modlock dev --sandbox` | Run the mod without the game. The menu and HUD render in the preview page it prints, and you can type chat commands there |

The sandbox saves settings to the same place as the real game (`%APPDATA%\modlock\files\doorman-trainer`), so changes made there carry over.

## Code map

| File | Role |
|---|---|
| `main.ts` | Wires Modlock events to the modules: start, world, join/leave, spawn, casts, projectiles, kills, damage (Invincible, the Mid-Boss), input, frames |
| `src/config.ts` | Settings, defaults, `sanitize()` (validation and one-time migrations), item presets, `practiceAids()` |
| `src/levels.ts` | The 10 ladder levels, `effective()` (what a round uses in each mode), ladder progress |
| `src/endless.ts` | Endless waves, scoring, best scores (pure logic) |
| `src/midboss.ts` | Mid-Boss fight: drain, kidnaps, scoring, best scores (pure logic) |
| `src/boss.ts` | The real Mid-Boss: finds or spawns it, reads and sets its health |
| `src/round.ts` | The round loop: setup → fight → follow → result, retry/next, re-placing doors, the Endless and Mid-Boss flows, the fall guard |
| `src/tracker.ts` | Kidnap detection and miss reasons (pure logic) |
| `src/walker.ts` | Bots the trainer drives: strafing with jump, slide and dash, the fighter, and shooting the Mid-Boss |
| `src/bots.ts` | Bot roster: create, rebuild, hero pool |
| `src/build.ts` | Hero build: ability tiers set directly, starting items, cooldown resets |
| `src/locations.ts` | Built-in locations from map entities, custom spots, spot picking, hidden spots |
| `src/placement.ts` | Where bots stand around a fight spot or in the pit |
| `src/doors.ts` | Door entities |
| `src/keys.ts` | Quick keys: Reload, Use, Jump |
| `src/ui.tsx`, `src/debughud.tsx` | Menu, HUD, debug overlay |
| `src/stats.ts`, `src/commands.ts`, `src/util.ts` | Stats, chat commands, helpers (queued file saves) |
| `tests/logic.test.ts` | `npm test`, with a stand-in for Modlock in `tests/stub/` |
| `installer/` | The Windows installer (Inno Setup) and the launcher its shortcuts run |
| `scripts/make-art.py` | Draws the icon and the README banner (Python with Pillow) |

## How the important parts work

- **Kidnap detection.** The cart projectile is watched (`watchProjectiles`), and enemies carrying the cart's effect are found through `modifiers()`. A kidnap is a one-frame jump of 400+ units that lands within about 320 units of one of the open doors while the cart is in play. "In play" means the enemy carries the cart's effect, the cart itself jumped through a door in the last second, or the cart was thrown in the last 3 s. The Hotel Guest ult is excluded. Misses are explained step by step: no door 1, no door 2, no cart, cart missed, or dragged but missed the door.
- **Door 1.** It counts when a door entity appears that wasn't there when setup began, or when a Doorway cast is seen. There's no timer.
- **Doors gone mid-fight.** If no door stands for 1 s, the clock pauses. The player goes to door 1's spot with cooldowns refreshed, places door 1, and comes back to where they stood. Bots stay where they were.
- **Locations.** Generated from the map's Guardians (`npc_trooper_boss`), Walkers (`npc_boss_tier2`), Patrons (`npc_boss_tier3`) and the Mid-Boss (`npc_super_neutral`, or the midpoint between the bases if it isn't there). Lanes pair with the enemy tower at the same sideways offset across the base-to-base axis. Spots must be standable ground near the expected height, with no roof over a lower floor (the sewers), and lines of sight are preferred. Towers spawn a few seconds after the map loads, so generation runs again at 5 s, at 20 s, and on Start.
- **The Mid-Boss.** The map's own one is used when it's up; otherwise `spawnNpc` puts one on the pit floor. Its real health is the fight's bar. Enemy bots shoot it unless the player is close, and each enemy in the pit drains it on top of real hits. The player's own hits on it are blocked. It's removed just before it would die, so no Rejuvenator goes to the bots. If the game refuses the spawn, the bar is simulated.
- **Hero build.** `resetHero(souls)`, then ability tiers are set directly with `setAbility({ upgrades })`. Training that grants exactly each step's cost is the fallback. Starting items are given free.
- **Bots.** The game's bot brain idles here, so `player.drive()` moves them. The fighter (`fight()` in `walker.ts`) keeps a range band, strafes and dodges, aims with a reaction delay and a turn-speed limit, dives in for melee and abilities, retreats when hurt, and spreads out; the numbers per difficulty are in `SKILL`. Bot difficulty is the game's `citadel_default_bot_difficulty` (1–3).
- **Data.** JSON files through Modlock's `writeFile`, queued and written one per frame at most every 0.5 s to avoid hitches. They live in `%APPDATA%\modlock\files\doorman-trainer`.

## Releasing

1. Raise `version` in `mod.json` and `package.json` (for example `0.2.0`).
2. Optionally write the release notes in `docs/releases/0.2.0.md`. Without that file, GitHub writes notes from the commits.
3. Commit, then push a tag that matches: `git tag v0.2.0` and `git push origin v0.2.0`.

The [Release workflow](../.github/workflows/release.yml) checks that the tag matches `mod.json`, runs the type check and tests, and packages the mod with `modlock publish --to archive`. That zip holds `modlock.exe`, the built mod and `Play.cmd`. The workflow builds the installer from it with Inno Setup, then publishes a release with two files:

- `DoormanTrainer-win-Setup.exe`: installs for the current user (no admin prompt), with a Start menu and desktop shortcut that run `installer/Doorman Trainer.cmd`. That runs `installer/launcher.ps1`, which installs a newer release silently if GitHub has one, runs `modlock.exe play mod`, and stops it when Deadlock closes.

Try the launcher without the game: `powershell -ExecutionPolicy Bypass -Command "& .\installer\launcher.ps1 -NoUpdate -Trainer powershell.exe -TrainerArgs '-Command','Start-Sleep 600' -Game notepad"` follows Notepad instead of Deadlock.
- `DoormanTrainer-win-Portable.zip`: Modlock's zip, renamed. Unzip it and run `Play.cmd`.

The README's download button points at `releases/latest/download/DoormanTrainer-win-Setup.exe`, so keep that file name.

## Verified in game

Hero build and items; built-in locations (6 Guardians, 6 Walkers, the Mid-Boss pit); the menu; kidnap detection through the cart's effect and cart jumps; the ladder pass and unlock.

## Not verified yet

The quick keys after the change to register them at server start; the fighter's dives and abilities; door re-placement; Endless end to end; the Mid-Boss mode with the real Mid-Boss; the short Cart and Vortex Web switches; Invincible; the fall guard; the item pictures in the Build tab; the installer on a clean PC.

## Ideas for later

Each of these would be a new drill in its own tab, reusing the round loop:

- **Door 2 placement drill**: a target circle appears, and you place door 2 inside it as fast as you can.
- **Call Bell drill**: hit as many enemies as you can with one Bell; scored by count.
- **Hotel Guest timing**: ult an enemy, then have a door ready where they come back.
- **Save an ally**: cart a low-health ally bot out of a fight through your doors to your team.
- **Defend the tower**: enemies push your Guardian in waves, and you kidnap them into it.
- **Leaderboard**: a Modlock board in `mod.json` for Endless and Mid-Boss best scores, to compare with friends.
