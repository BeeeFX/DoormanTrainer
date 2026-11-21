# Doorman Trainer guide

Everything the trainer can do. To get started, see the [README](../README.md).

## A try, step by step

1. **Door 1.** You start at door 1's spot. Place it whenever you're ready: the fight starts the moment it's down.
2. **The fight.** You're dropped in with the bots. Place door 2 and Luggage Cart someone through.
3. **Kidnapped!** It counts as soon as they come out of your door, no kill needed. The fight runs on for 4 s so you can watch where they land, or jump in after them.
4. **Result.** If you missed, it says why: no door 2, cart missed, or dragged them but missed the door. The next try starts by itself.

If both your doors close mid-fight, the clock pauses and you're sent to place door 1 again, then put back where you stood. You can switch this off in Settings.

## Modes

| | |
| --- | --- |
| **Ladder** | 10 levels: Stationary, Walking, Sliding, Jumping, Agile, Duel, Skirmish, Teamfight, Full fight, Gauntlet. Pass one (usually 5 kidnaps in your last 8) to unlock the next |
| **Endless** | Kidnap every enemy before the wave clock runs out. More enemies and less time each wave, smarter bots every 6 waves. Points per kidnap, ×2 when one cart brings two, plus a bonus per cleared wave. Best score saved per difficulty |
| **Mid-Boss** | The enemy team is taking the real Mid-Boss: they shoot it, and its health drains faster with each one in the pit. Kidnap them out to your team at door 1; they come back after their respawn time. Keep it alive until the clock runs out. Your own hits on it don't count |
| **Practice** | Your own setup: enemies, allies, heroes, behaviour (Still, Walk with jumps, slides and dashes, or Full AI) and difficulty (Easy, Medium or Hard) |

## Settings

| | |
| --- | --- |
| **Build** | Souls, max all abilities (on by default), Doorway range upgrade, starting items. The default build is Trophy Collector, Greater Expansion, Cheat Death, Vortex Web, Rapid Recharge and Superior Duration |
| **Cooldowns** | Real, short (3 s) or none. Each mode also has its own switches for a short Luggage Cart or Vortex Web cooldown |
| **Invincible** | Nothing hurts you |
| **Locations** | Spots by every Guardian and Walker on your side and in the Mid-Boss pit. Pick any mix, look at one with **Go**, or record your own |
| **Settings tab** | Auto-continue, move up on pass, what happens after a miss, fight time, watch-after-kidnap time, re-placing doors, your side, troopers, kidnap detection, debug overlay |
| **Stats** | Attempts, kidnaps, streaks, door 2 to cart time, why you missed, rates per location |

With short or no cooldowns, or Invincible, ladder progress and best scores aren't saved.

## Controls

| When | Key | Does |
| --- | --- | --- |
| Result screen | **Reload** (tap) | Retry the same setup |
| Result screen | **Jump** (tap) | Next setup |
| Between tries | **Use** (tap) | Open the menu |
| During a try | **Reload** (hold) | Restart this setup |
| During a try | **Use** (hold) | Skip to the next setup |

`/dt` in chat opens the menu at any time.

## Bots

Walking bots strafe around their spot, with jumps, slides and dashes on the movement levels. Full AI bots keep their distance, strafe across your aim, dodge, dive in to melee and use abilities, and back off when hurt. Harder bots react faster and aim better.

## Chat commands

`/dt` menu · `/start` `/stop` `/skip` · `/level 1-10` `/custom` · `/bots` `/allies` `/difficulty easy|medium|hard` `/behaviour still|walk|fight` · `/souls` `/team 2|3` `/fastcd real|short|none` `/invincible` `/range` · `/tower <name>` `/fight [name]` `/spots` `/goto <location> [spot]` `/deltower` `/delfight` `/badspot` · `/probe` `/where` `/units` `/relocate` `/detect` `/debug` · `/stats` `/resetstats` · `/help`

## Questions

**Does it change my normal game?** No. Nothing is installed into Deadlock. The trainer runs its own local server and starts Deadlock into it. Launching Deadlock from Steam is exactly as before.

**Do I need an internet connection?** Yes, for the in-game menu, which loads through Modlock's page.

**I clicked "Leave testing" and ended up in the hideout.** That leaves the trainer. Close the trainer's window and double-click **Doorman Trainer** again, or type `connect 127.0.0.1:27067` in the game console.

**There's no menu.** Only one trainer can run at a time. Close every trainer window and start it again.

**A kidnap didn't count.** Turn on Settings → Debug overlay to see what the trainer saw, and [open an issue](https://github.com/BeeeFX/DoormanTrainer/issues) with the spot and what happened.

**I got put inside a wall or under the map.** Type `/badspot` during that try. The spot is hidden for good and you move on. Locations can bring hidden spots back.

**Where are my settings and scores?** In `%APPDATA%\modlock\files\doorman-trainer`. Uninstalling keeps them.

**Can I use it without installing?** Download `DoormanTrainer-win-Portable.zip` from the [latest release](https://github.com/BeeeFX/DoormanTrainer/releases/latest), unzip it anywhere and run `Play.cmd`.
