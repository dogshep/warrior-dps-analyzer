# Warrior DPS Analyzer

A web page for WoW Forever DPS warriors. Drop in a combat log, or paste a Warcraft Logs report link, and get a short list of things to try on your next dungeon or raid.

It runs entirely in your browser:

1. **Parses the log** (`WoWCombatLog-*.txt`): fights (boss encounters and trash pulls), your casts, damage, rage, buffs, deaths, and your gear and enchants from `COMBATANT_INFO`.
2. **Sims your exact gear** with [wowsims/forever](https://github.com/wowsims/forever), compiled to WebAssembly, using the wowsims Fury, Fury 2H or Arms rotation, the fight's length and target count, and the buffs and consumables seen in the log.
3. **Compares you to the sim.** For each ability it compares your casts to the sim's and prices the gap using your own damage per cast. It also checks cooldowns (Death Wish, Recklessness, Bloodrage, racials), Battle Shout uptime, rage use (capping, or Heroic Strike starving Bloodthirst and Whirlwind), the execute phase, time spent not attacking, deaths, missing enchants and missing consumables.
4. **Ranks the suggestions** by estimated DPS gained. Each play tip links to the matching section of the Forever Fury
   guides from [Warcraft Tavern](https://www.warcrafttavern.com/forever/guides/fury-warrior/) and
   [Icy Veins](https://www.icy-veins.com/wow-forever/fury-warrior-melee-dps-pve-rotation-cooldowns-abilities).
   Overpower and Rend are marked optional, since they only pay in narrow cases. Where a guide and the sim
   disagree, the tips follow the sim's rotation.
5. **Finds gear upgrades** on request: the best next item per slot and where it drops, is crafted or sold.

## Speed

The page downloads and compiles the 6 MB sim once, then hands it to up to 4 Web Workers that start while you
pick a log, so Analyze usually takes 6 to 9 seconds. Big Warcraft Logs pages stream through the Worker instead of
being buffered, so long dungeon runs don't hit its time limit.

## How gear upgrades are found

Simming every item for every player would take far too long, so the work is split in two.

- **At build time** (`scripts/precompute-upgrades.mjs`, about 14 minutes on 4 cores, cached in CI by wowsims commit):
  for each rotation it sims stat weights in the wowsims pre-raid gear, prices every level 60 rare or better item a
  warrior can use and can get in Forever now (wowsims' phase 1, less what `data/forever-availability.json` holds back)
  with them, and sims the ones weights can't price (weapons, procs, on-use effects) swapped into
  that gear. The result, with each item's sources from the wowsims item database, is `web/sim/upgrades.json`.
- **In the browser** the page takes the best one or two of those per slot that beat what the player wears (8, 16
  or 24 in all) from the sources ticked (dungeons, raids, crafted, quests, vendors, reputation, PvP), sims each one
  swapped into the player's own gear and fight, and lists the real gains.
- **Hit cap and set bonuses.** Before simming, the page reads the sim's character sheet for each swap (a few
  milliseconds each). A swap that would leave special attacks missing, when they don't now (or more often than now),
  is left out and listed as such. A swap that breaks a set bonus is flagged, with what the bonus is worth: one extra
  sim of the gear without that item, its stats added back, against the current gear.
- **Enchants** are only suggested when they are in Forever: not the ones wowsims marks unavailable (such as the
  Zul'Gurub and Naxxramas shoulder enchants), and not Forever's own enchant scrolls that Wowhead lists as PTR only
  (Living Stats, Grand Crusader, +5 Agility on cloaks, +15 Strength on gloves).

### What counts as "in Forever"

wowsims/forever flags every item and enchant as obtainable now or not yet, but a few of its calls don't match the
live game. [`data/forever-availability.json`](data/forever-availability.json) is the one hand-kept list that
corrects them, with the reason and source for each entry. The build (`scripts/make_names.py` for enchants,
`scripts/precompute-upgrades.mjs` via `scripts/availability.mjs` for gear) reads it; the page never needs editing.
Dated entries release themselves: raid loot, Head of Onyxia rewards, Onyxia scale crafts and The Watchers'
(Barrow Deeps) reputation rings show up once Forever opens its raids (the date is in `data/forever-availability.json`), without a rebuild.

Two sims of different gear don't share their dice rolls, so a gain from 100 fights is only good to about ±13 DPS.
The page picks the fight count (200 to 1,000) so the run takes about a minute, runs sims side by side on spare
CPU cores (up to 4), shows the margin on each gain, and stops at 2 minutes whatever happens. In headless
Chromium on 4 cores the sample log takes about 50 to 55 seconds for 8, 16 or 24 items.

### Auction house prices for crafted upgrades

Crafted upgrades show an approximate gold cost: the lowest buyout (and the median when several are listed) on the
auction house the viewer picks (US or EU, realm type, their log's faction). `.github/workflows/ah-prices.yml` runs
`scripts/ah-prices.mjs` every 3 hours. It reads Blizzard's Game Data API for WoW Forever
(`/data/wow/ruleset/{ruleset}/auctions/{house}`, namespace `dynamic-forever-{region}`; not documented by Blizzard
yet), keeps only the crafted items in the live `upgrades.json`, and force-pushes a small `prices.json` to the
`ah-prices` branch, which the page reads from raw.githubusercontent.com. The page says when Blizzard's data was
last updated beside the price choices. Each crafted upgrade also shows what its materials cost: the recipe
comes from Blizzard's profession and recipe data (`static-forever` namespace), and each reagent is priced by
buying the amount one craft needs from the cheapest listings on that house's commodities list. Hovering the
materials line lists the reagents. Reagents with too few listed are counted separately, not guessed. Needs the repo secrets `BNET_CLIENT_ID` and `BNET_CLIENT_SECRET` (a free
client from develop.battle.net). Prices are Blizzard's data, credited on the page.

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

Needs Go (the version in wowsims' `go.mod`), Python 3 with `pip install grpcio-tools==1.85.4`, and Node (the version in `.node-version`).

```sh
scripts/build-sim.sh            # clones wowsims/forever into .wowsims and builds web/sim/ (SKIP_UPGRADES=1 skips the slow gear ranking)
python3 -m http.server -d web   # then open http://localhost:8000
node tests/run_analysis.mjs path/to/WoWCombatLog.txt 300   # the same analysis in the terminal
npm test                        # unit tests: every tests/*_test.mjs (CI runs this on every pull request)
npm run test:addon              # addon tests; needs lua5.1
```

`tests/make_fixture.mjs` writes the synthetic sample log in `tests/`. It plays a deliberately sloppy fury rotation and exists to smoke test the pipeline.

### Sample report

"Try a sample report" on the page (or a link ending in `#sample`) shows finished results for a made-up Fury warrior on Onyxia, without running the sim and without Warcraft Logs. `web/js/sample.js` fills the results page from `web/sample/sample-report.json`. Nobody real is in the log: the players are `Sample*` with placeholder ids.

```sh
node scripts/make-sample-log.mjs web/sample/sample-WoWCombatLog.txt   # the made-up log (boss health, Flurry, sloppy rotation)
node scripts/make-sample.mjs 1000                                      # runs the real page on it in headless Chromium and saves the results
```

Rerun `make-sample.mjs` after changing the log, how results are shown, or the sim version; it needs a full `scripts/build-sim.sh` (with the upgrade list) and takes about two minutes. `tests/sample_test.mjs` checks the log still has what the sample is for and the snapshot has every part.

## Layout

| Path | What |
| --- | --- |
| `web/index.html`, `web/style.css`, `web/js/app.js` | The page |
| `web/js/logparser.js` | Combat log parser |
| `web/js/analyze.js` | Fight metrics, the wowsims request, sim comparison and suggestions |
| `web/js/cooldowns.js` | Cooldown timing (missed uses, holding for execute, per-pull view on dungeon runs) |
| `web/js/rage.js` | Rage read (Heroic Strike starving or overcapping) and the execute phase report |
| `web/js/simpool.js`, `web/js/sim-worker.js` | Downloads the WASM sim once and runs it in up to 4 Web Workers |
| `web/js/sample.js`, `web/sample/` | The "Try a sample report" demo and its made-up log and snapshot |
| `web/js/upgrades.js` | Picks upgrade candidates per slot and reads the sim results |
| `web/js/wcl.js`, `web/js/wcl-queries.js` | Warcraft Logs import: through the Worker, or with the viewer's own sign-in |
| `worker/` | Cloudflare Worker that loads public Warcraft Logs reports with no sign-in ([worker/README.md](worker/README.md)) |
| `scripts/build-sim.sh`, `scripts/make_names.py` | Build the sim and the item/spell name tables into `web/sim/` |
| `scripts/precompute-upgrades.mjs` | Ranks gear per rotation for the upgrades section (`web/sim/upgrades.json`) |
| `scripts/ah-prices.mjs`, `web/js/prices.js` | Auction house prices for crafted upgrades (`ah-prices` branch) |
| `scripts/availability.mjs`, `data/forever-availability.json` | The hand-kept list of what Forever has not released yet, applied at build time |
| `scripts/make-sample-log.mjs`, `scripts/make-sample.mjs` | Regenerate the sample report (see above; the second needs Playwright installed) |
| `tests/` | Unit tests (`*_test.mjs`, run by `npm test`), the sample log fixture, and a few dev CLIs (`run_analysis.mjs`, `run_wcl.mjs`, `wcl_mock.mjs`) |
| `addon/WarriorTips/` | The in-game addon |
| `SIM_REF` | The pinned wowsims/forever commit |

Sim by [WoWSims](https://github.com/wowsims/forever) (MIT).

## Warcraft Logs import

Public reports load with no sign-in through a small Cloudflare Worker in `worker/` that holds this site's own
Warcraft Logs client. It only runs the page's own queries, caches answers, and rate-limits each IP. Setup and the
GitHub secrets it needs are in [worker/README.md](worker/README.md); without them the deploy skips the Worker and
the page falls back to sign-in.

Private reports need the viewer to sign in, which needs a public Warcraft Logs API client registered to this site, once:

1. Signed in on forever.warcraftlogs.com, open your profile's API clients page and create a client.
2. Name it (for example "Warrior DPS Analyzer"), set the redirect URL to `https://dogshep.github.io/warrior-dps-analyzer/`, and tick **Public client**.
3. Put its client id in `WCL_CLIENT_ID` in `web/js/wcl.js`. A client id is not a secret.

The page only offers sign-in when a report fails to load because it is private. For a local copy, add
`http://localhost:8000/` as a second redirect URL.

`node tests/wcl_mock.mjs tests/fixture-WoWCombatLog.txt` turns the sample log into Warcraft Logs API responses, for testing the import offline.

## Security

The page sets a strict Content-Security-Policy (scripts and workers from this site only, network calls only to
Warcraft Logs and the Worker), escapes everything it shows from a log, checks the OAuth `state` on sign-in, and caps
the length of one log line and the sim iteration count. The deploy builds wowsims in a job with no secrets, as described above.

## In-game addon

`addon/WarriorTips` is a companion WoW Forever addon with live tips and a post-fight report card. See [addon/README.md](addon/README.md).

## License

MIT, see [LICENSE](LICENSE). The addon folder carries its own copy (`addon/WarriorTips/LICENSE.txt`) so it ships with the download.
