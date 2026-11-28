---
description: Review a diff with parallel reviewers tuned to this repo (tests, security, sim performance, Forever availability, correctness, deploy safety)
argument-hint: "[PR number | branch | SHA | file paths]  (default: current branch vs main)"
---

# Code review

Review a change to the Warrior DPS Analyzer with six reviewer subagents running in parallel, then check their findings and write one report.

Adapted from https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents, with the reviewers moved into `.claude/agents/` and focused on what can go wrong in this repo: the static page in `web/`, the Cloudflare Worker in `worker/`, the wowsims Go/WASM sim built by `scripts/build-sim.sh`, the GitHub Actions in `.github/workflows/`, the hand-kept list `data/forever-availability.json`, and the WoW addon in `addon/`.

## 1. Work out the scope

Use the first of these that applies. `$ARGUMENTS` is what the user typed after the command.

1. `$ARGUMENTS` names a PR (a number or a URL): `gh pr diff <n>` and `gh pr view <n>` for the title and body.
2. `$ARGUMENTS` names a branch or SHA: `git diff main...<ref>` (or `git show <sha>`).
3. `$ARGUMENTS` names file paths: review those files whole (and `git diff main -- <paths>` if they changed).
4. On a branch other than `main`: `git diff main...HEAD`, plus any uncommitted changes (`git diff HEAD`).
5. On `main` with staged changes: `git diff --staged`. With nothing staged: `git show HEAD`.

If the shallow clone has no `main`, run `git fetch --depth=50 origin main` first. Write the diff to a temp file and note the list of changed files. If the diff is empty, say so and stop.

## 2. Pick the reviewers

Always launch `test-runner`, `correctness-reviewer` and `security-reviewer`. Launch the others when the diff touches their area:

| Reviewer | Launch when the diff touches |
|---|---|
| `security-reviewer` | always |
| `perf-reviewer` | `web/js/` (sim, parser, upgrades, simpool, sim-worker), `worker/`, `scripts/precompute-upgrades.mjs`, `scripts/build-sim.sh`, `SIM_REF` |
| `availability-reviewer` | `data/forever-availability.json`, `scripts/availability.mjs`, `scripts/make_names.py`, `scripts/precompute-upgrades.mjs`, `web/js/upgrades.js`, `web/js/prices.js`, or anything that decides which items, enchants or consumables get suggested |
| `deploy-reviewer` | `.github/workflows/`, `worker/wrangler.toml`, `worker/package*.json`, `scripts/build-sim.sh`, `SIM_REF`, `web/index.html` (CSP) |

If the user passed `all`, launch every reviewer. Launch them **in parallel, in one message with several Agent calls**. Give each one the diff file path, the changed file list, and the PR title and body if there is one. Tell each to return findings only in the format its own instructions give.

## 3. Check the findings

Reviewers guess. Before reporting, check every Critical and High finding yourself against the code: open the file at the line, follow the call, and confirm the failure can actually happen. Drop what does not hold up, and lower the severity of what only happens in an unlikely setup. Merge duplicates that two reviewers found. Keep Medium and Low findings as reported unless they are plainly wrong.

## 4. Report

Write the report in this shape, and keep it short. Leave out sections with nothing in them, except Verdict.

```
## Code review: <what was reviewed>

### Needs attention (N)
1. **[Security] Critical** `worker/index.js:120` – what is wrong, the concrete way it fails, and the fix.
2. ...

### Suggestions (N)
- **[Perf] Medium, small effort** `web/js/simpool.js:88` – what to change and why.

### All clear
Tests: 14 passed. Availability: no concerns. Deploy: no concerns.

### Verdict: Ready to merge | Needs attention | Needs work
```

Verdict rules: **Ready to merge** when tests pass and nothing is Critical or High. **Needs attention** when there are Medium issues or important suggestions. **Needs work** when anything is Critical or High, or a test fails.

Do not change any files during the review. If the user asked for fixes too (for example `/code-review fix`), apply them after the report, one finding at a time, and run the tests that cover them.
