# Warrior DPS Analyzer

A web page for WoW Forever DPS warriors. Drop in a combat log and get a short list of things to try on your next dungeon or raid.

It runs entirely in your browser:

1. **Parses the log** (`WoWCombatLog-*.txt`): fights (boss encounters and trash pulls), your casts, damage, rage, buffs, deaths, and your gear and enchants from `COMBATANT_INFO`.
2. **Sims your exact gear** with [wowsims/forever](https://github.com/wowsims/forever), compiled to WebAssembly, using the wowsims Fury, Fury 2H or Arms rotation, the fight's length and target count, and the buffs and consumables seen in the log.
3. **Compares you to the sim.** For each ability it compares your casts to the sim's and prices the gap using your own damage per cast. It also checks cooldowns (Death Wish, Recklessness, Bloodrage, racials), Battle Shout uptime, rage capping, time spent not attacking, deaths, missing enchants and missing consumables.
4. **Ranks the suggestions** by estimated DPS gained.

## Recording a good log

- Type `/combatlog` before you pull. The file goes to `World of Warcraft/_classic_era_/Logs/`.
- Turn on **Advanced Combat Logging** (System > Network). Without it the log has no gear and no rage data.

## Updating the sim

The page uses whatever version of wowsims/forever the deploy workflow built:

- `SIM_REF` holds the wowsims git ref (`master`, a tag, or a commit). Change it to pin a version.
- **Actions > Build sim and deploy > Run workflow** rebuilds now, and can take a one-off ref.
- The workflow also runs weekly (Tuesdays) to pick up sim fixes on `master`.

The page footer shows which wowsims commit is live.

## Running locally

Needs Go (the version in wowsims' `go.mod`), Python 3 with `pip install grpcio-tools`, and Node.

```sh
scripts/build-sim.sh            # clones wowsims/forever into .wowsims and builds web/sim/
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
| `scripts/build-sim.sh`, `scripts/make_names.py` | Build the sim and the item/spell name tables into `web/sim/` |

Sim by [WoWSims](https://github.com/wowsims/forever) (MIT).

## Warcraft Logs client

Link import needs a Warcraft Logs API client registered to this site, once:

1. Signed in on forever.warcraftlogs.com, open your profile's API clients page and create a client.
2. Name it (for example "Warrior DPS Analyzer"), set the redirect URL to `https://dogshep.github.io/warrior-dps-analyzer/`, and tick **Public client**.
3. Put its client id in `WCL_CLIENT_ID` in `web/js/wcl.js`. A client id is not a secret.

For a local copy, add `http://localhost:8000/` as a second redirect URL, or paste your own client id under "Warcraft Logs settings" on the page.

`node tests/wcl_mock.mjs tests/fixture-WoWCombatLog.txt` turns the sample log into Warcraft Logs API responses, for testing the import offline.
