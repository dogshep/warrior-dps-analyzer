# Warrior Tips (in-game addon)

A small WoW Forever addon that gives quiet, opt-in tips while you play a warrior, and a short report card in chat after boss fights. It is a companion to the web analyzer: the analyzer does the deep review from a combat log, the addon nudges you live.

## Install

Copy the `WarriorTips` folder into `World of Warcraft\_forever_\Interface\AddOns\` (the folder next to your other Forever addons) and restart the game or `/reload`. The toc uses interface `16001`; check yours with `/dump select(4, GetBuildInfo())`.

## First run: the probe

WoW Forever uses retail Midnight's addon restrictions. Addons cannot read the combat log at all, and in combat many values (rage, buffs, cooldowns, health) can be "secret": an addon can show them but its code cannot compare them. Which ones are secret is decided by the game per spell and per power type.

Type `/wtips probe`, then hit a target dummy or a mob for 5+ seconds. When combat ends it prints what was readable in combat and saves it to `WTF\Account\<account>\<realm>\<character>\SavedVariables\WarriorTips.lua`. Send that (or a screenshot) back so the tips can be tuned to what Forever actually allows.

## Tips

| Tip | Setting | Needs |
| --- | --- | --- |
| "Execute phase" when Execute becomes usable on a boss or elite, with Recklessness / Death Wish if they're ready on a boss | `execute` (on) | Spell usability, which is not secret |
| "Boss pull: Death Wish ready" when a boss encounter starts or you target a skull-level boss | `cooldowns` (on) | Cooldowns, read just before combat restrictions switch on |
| "Rage capped: queue Heroic Strike" after 1.5 s at the rage cap | `rage` (on) | Rage readable in combat (the probe tells you) |
| "Battle Shout drops in 5s" / "Battle Shout is down" | `shout` (on) | Battle Shout aura readable in combat, or your own casts visible |
| "Overpower!" / "Revenge!" when they light up | `reactive` (off) | Spell usability |

A tip whose data is secret stays quiet; nothing errors. There are at least 4 seconds between any two tips and each tip has its own repeat cooldown.

After a boss fight (or every fight over 15 s with `/wtips report all`) the chat report card shows fight length, DPS, your top damage sources from Blizzard's damage meter, whether Death Wish / Recklessness were ready and unused, time at the rage cap, and Battle Shout downtime. Cooldown use is only judged on bosses, because on dungeon trash the group's pace decides whether cooldowns are back.

## Commands

```
/wtips                     help
/wtips on | off            all live tips on or off
/wtips tip <name> on|off   execute, cooldowns, rage, shout, reactive
/wtips report boss|all|off when to print the report card
/wtips ragecap <n>         rage that counts as capping (default 80)
/wtips sound on|off        raid warning sound with each tip
/wtips unlock | lock       move the tip text
/wtips test                show a sample tip
/wtips probe               check what Forever lets addons read in combat
/wtips status
```

Settings are per character. Spell names are matched in English, so a non-English client needs the names in `Core.lua` translated.

## Testing offline

`lua5.1 tests/addon/run.lua` runs the addon against a mocked Forever API through a boss fight and prints the tips and the report card. `lua5.1 tests/addon/run.lua secret` does the same with rage, auras and cooldowns secret in combat, to check that tips degrade quietly.
