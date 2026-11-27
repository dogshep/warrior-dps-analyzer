# Warrior Tips (in-game addon)

A small WoW Forever addon that gives quiet, opt-in tips while you play a warrior, and a short report card in chat after boss fights. It is a companion to the web analyzer: the analyzer does the deep review from a combat log, the addon nudges you live.

## Install

Copy the `WarriorTips` folder into the `Interface\AddOns` folder of your WoW Forever install (where your other Forever addons are) and restart the game or `/reload`. The toc uses interface `16001`; check yours with `/dump select(4, GetBuildInfo())`.

## First run: the probe

WoW Forever uses retail Midnight's addon restrictions. Addons cannot read the combat log at all, and in combat many values (rage, buffs, cooldowns, health) can be "secret": an addon can show them but its code cannot compare them. Which ones are secret is decided by the game per spell and per power type.

Type `/wtips probe`, then hit a target dummy or a mob for 5+ seconds. When combat ends it prints what was readable in combat and saves it to `WTF\Account\<account>\<realm>\<character>\SavedVariables\WarriorTips.lua`. Send that (or a screenshot) back so the tips can be tuned to what Forever actually allows.

## Tips

What Forever lets addons read in combat (probe run on 2026-11-27): spell usability, target classification and the spell id of your own casts are readable; rage, health, cooldowns and buffs are secret. The tips are built around that:

| Tip | Setting | How it knows |
| --- | --- | --- |
| "Execute phase" when Execute becomes usable on a boss or elite, with Recklessness / Death Wish if they're ready on a boss | `execute` (on) | Spell usability |
| "Boss pull: Death Wish ready" when a boss encounter starts or you target a skull-level boss, and "Death Wish is ready again" mid boss fight | `cooldowns` (on) | A clean cooldown read just before combat restrictions switch on, plus your own casts and the cooldown length (learned from out-of-combat reads, so talents count) |
| "Rage capped: Heroic Strike" line under the tips while rage is at the cap | `rage` (on) | Rage is secret, so the game colors this line from your rage through a color curve: it is invisible below the cap and gold at or above it. Display only, so it is not counted in the report |
| "Battle Shout drops in 5s" / "Battle Shout is down" | `shout` (on) | The buff's time left before the pull, plus your own Battle Shout casts |
| "Overpower!" / "Revenge!" when they light up | `reactive` (off) | Spell usability |

A tip whose data is hidden stays quiet; nothing errors. There are at least 4 seconds between any two tips and each tip has its own repeat cooldown.

After a boss fight (or every fight over 15 s with `/wtips report all`) the chat report card shows fight length, DPS and your top damage sources from Blizzard's damage meter, how many Executes you cast in the Execute phase, Bloodthirst / Mortal Strike / Whirlwind casts against how many were possible, whether Death Wish / Recklessness were ready and unused, and Battle Shout downtime. Cooldown use is only judged on bosses, because on dungeon trash the group's pace decides whether cooldowns are back.

## Options window

Type `/wtips` (or open Esc > Options > AddOns > Warrior Tips) for the options window. It has every setting: tips on or off one by one, sound, when to print the report card, debug mode, text size, rage cap, tip and rage line colors (click a swatch for the color picker), plus buttons to move the tips, show a test tip and run the probe. The slash commands below do the same things, and the window updates when you use them.

## Commands

```
/wtips                     open the options window
/wtips help                list the commands
/wtips on | off            all live tips on or off
/wtips tip <name> on|off   execute, cooldowns, rage, shout, reactive
/wtips report boss|all|off when to print the report card (all = every fight over 15 s)
/wtips ragecap <n>         rage that counts as capping (default 80)
/wtips size <10-40>        tip text size (default 18; the rage line is 80% of it)
/wtips color [color]       tip color: gold, white, red, orange, yellow, green, cyan,
                           blue, purple, pink or a hex code like ff8800; no value opens
                           the color picker
/wtips ragecolor [color]   same, for the rage capped line
/wtips sound on|off        raid warning sound with each tip
/wtips unlock | lock       move the tip text
/wtips test                show a sample tip
/wtips probe               check what Forever lets addons read in combat
/wtips debug on|off        testing: full report card after every fight, even short
                           trash, with every number the addon saw, plus Lua errors
/wtips status
```

Settings are per character. Spell names are matched in English, so a non-English client needs the names in `Core.lua` translated.

## Testing offline

`lua5.1 tests/addon/run.lua` runs the addon against a mocked Forever API through a boss fight and prints the tips and the report card. `lua5.1 tests/addon/run.lua secret` does the same with what the probe found on Forever: rage, health and cooldowns secret in combat, buffs coming back empty, own casts readable.
