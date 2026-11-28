"""Writes version.json: which wowsims/forever commit the sim was built from, and when.
Run from inside the wowsims checkout (it asks git for HEAD). Usage: python3 -I make_version.py <out.json>"""
import datetime
import json
import subprocess
import sys

git = lambda *args: subprocess.check_output(["git", *args], text=True).strip()
version = {
    "repo": "wowsims/forever",
    "commit": git("rev-parse", "HEAD"),
    "commitDate": git("log", "-1", "--format=%cI"),
    "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
}
with open(sys.argv[1], "w") as f:
    json.dump(version, f, indent=1)
