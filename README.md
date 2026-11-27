# Warrior DPS Analyzer

A web page for WoW Forever DPS warriors. Drop in a combat log and get a short list of things to try on your next dungeon or raid.

It runs entirely in your browser:

1. **Parses the log** (`WoWCombatLog-*.txt`): fights (boss encounters and trash pulls), your casts, damage, rage, buffs, deaths, and your gear and enchants from `COMBATANT_INFO`.
2. **Sims your exact gear** with [wowsims/forever](https://github.com/wowsims/forever), compiled to WebAssembly, using the wowsims Fury, Fury 2H or Arms rotation, the fight's length and target count, and the buffs and consumables seen in the log.
3. **Compares you to the sim.** For each ability it compares your casts to the sim's and prices the gap using your own damage per cast. It also checks cooldowns (Death Wish, Recklessness, Bloodrage, racials), Battle Shout uptime, rage capping, time spent not attacking, deaths, missing enchants and missing consumables.
4. **Ranks the suggestions** by estimated DPS gained.
5. **Finds gear upgrades** on request: the best next item per slot and where it drops, is crafted or sold.

## How gear upgrades are found

Simming every item for every player would take far too long, so the work is split in two.

- **At build time** (`scripts/precompute-upgrades.mjs`, about 13 minutes on 4 cores, cached in CI by wowsims commit):
  for each rotation it sims stat weights in the wowsims pre-raid gear, prices every level 60 rare or better item a
  warrior can use with them, and sims the ones weights can't price (weapons, procs, on-use effects) swapped into
  that gear. The result, with each item's sources from the wowsims item database, is `web/sim/upgrades.json`.
- **In the browser** the page takes the best one or two of those per slot that beat what the player wears (8, 16
  or 24 in all), sims each one swapped into the player's own gear and fight, and lists the real gains.

Two sims of different gear don't share their dice rolls, so a gain from 100 fights is only good to about ±13 DPS.
The page picks the fight count (200 to 1,000) so the run takes about a minute, runs sims side by side on spare
CPU cores (up to 4), shows the margin on each gain, and stops at 2 minutes whatever happens. In headless
Chromium on 4 cores the sample log takes about 50 seconds for 8, 16 or 24 items.

## Recording a good log

- Type `/combatlog` before you pull. The file goes to `World of Warcraft/_forever_/Logs/`.
- Turn on **Advanced Combat Logging** (System > Network). Without it the log has no gear and no rage data.

## Updating the sim

The page uses whatever version of wowsims/forever the deploy workflow built:

- `SIM_REF` holds the wowsims commit the site is built from. Only reviewed commits should go in it, because
  the build runs wowsims code and the result is served to every visitor.
- Every Tuesday, **Check for a new sim version** (`.github/workflows/sim-bump.yml`) opens a PR that bumps
  `SIM_REF` when wowsims `master` has moved, with a link to the upstream changes. Merging it deploys the new sim.
  This needs **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests**.
- **Actions > Build sim and deploy > Run workflow** rebuilds now, and can take a one-off ref.
- The deploy keeps wowsims code away from the secrets: the sim is built and tested in a job with no secrets
  and read-only access, and the Worker is deployed from a separate job that never checks out wowsims.

The page footer shows which wowsims commit is live.

## Running locally

Needs Go (the version in wowsims' `go.mod`), Python 3 with `pip install grpcio-tools==1.85.4`, and Node.

```sh
scripts/build-sim.sh            # clones wowsims/forever into .wowsims and builds web/sim/ (SKIP_UPGRADES=1 skips the slow gear ranking)
python3 -m http.server -d web   # then open http://localhost:8000
node tests/run_analysis.mjs path/to/WoWCombatLog.txt 300   # the same analysis in the terminal
```

`tests/make_fixture.mjs` writes the synthetic sample log in `tests/`. It plays a deliberately sloppy fury rotation and exists to smoke test the pipeline.

## Layout

| Path | What |
| --- | --- |
| `web/index.html`, `web/style.css`, `web/js/app.js` | The page |
| `web/js/logparser.js` | Combat log parser |
| `web/js/analyze.js` | Fight metrics, the wowsims request, sim comparison and suggestions |
| `web/js/sim-worker.js` | Loads the WASM sim in a Web Worker |
| `web/js/upgrades.js` | Picks upgrade candidates per slot and reads the sim results |
| `scripts/build-sim.sh`, `scripts/make_names.py` | Build the sim and the item/spell name tables into `web/sim/` |
| `scripts/precompute-upgrades.mjs` | Ranks gear per rotation for the upgrades section (`web/sim/upgrades.json`) |

Sim by [WoWSims](https://github.com/wowsims/forever) (MIT).

## Warcraft Logs client

Link import needs a Warcraft Logs API client registered to this site, once:

1. Signed in on forever.warcraftlogs.com, open your profile's API clients page and create a client.
2. Name it (for example "Warrior DPS Analyzer"), set the redirect URL to `https://dogshep.github.io/warrior-dps-analyzer/`, and tick **Public client**.
3. Put its client id in `WCL_CLIENT_ID` in `web/js/wcl.js`. A client id is not a secret.

For a local copy, add `http://localhost:8000/` as a second redirect URL, or paste your own client id under "Warcraft Logs settings" on the page.

`node tests/wcl_mock.mjs tests/fixture-WoWCombatLog.txt` turns the sample log into Warcraft Logs API responses, for testing the import offline.

## In-game addon

`addon/WarriorTips` is a companion WoW Forever addon with live tips and a post-fight report card. See [addon/README.md](addon/README.md).

## License

MIT, see [LICENSE](LICENSE). The addon folder carries its own copy (`addon/WarriorTips/LICENSE.txt`) so it ships with the download.
