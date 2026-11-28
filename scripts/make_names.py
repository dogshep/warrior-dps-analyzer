"""Writes the slim lookup tables the page uses from wowsims' db.json: item names and slots, enchant names and phases,
spell names, and which aura (buff) ids belong to which consumable.
Enchants WoW Forever does not have yet (data/forever-availability.json) get phase 2, like wowsims' Unknown ones."""
import json, os, sys

with open(sys.argv[1]) as f:
    db = json.load(f)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "forever-availability.json")) as f:
    avail = json.load(f)
ptr = avail["ptrOnlyEnchantItems"]
ptr_items = set(ptr["ids"]) | {i for lo, hi in ptr["ranges"] for i in range(lo, hi + 1)}
held_enchants = {int(k) for k in avail["enchantsNotInForever"] if not k.startswith("_")}
out = {"items": {}, "enchants": {}, "enchantPhase": {}, "enchantStats": {}, "setItems": {}, "spells": {}, "consumes": {}, "imbues": {}}
sparse = lambda arr: {i: v for i, v in enumerate(arr or []) if v}
for it in db.get("items", []):
    so = (it.get("scalingOptions") or {}).get("0", {})
    # [name, item type, quality, ilvl, hand type (4 = two-hand), weapon speed]
    out["items"][it["id"]] = [it.get("name", ""), it.get("type", 0), it.get("quality", 0), so.get("ilvl", 0), it.get("handType", 0), it.get("weaponSpeed", 0)]
    # Armor in a set: its stats, so the page can price the set bonus (the gear without the item, its stats added back).
    if it.get("setId") and it.get("type") != 13:
        out["setItems"][it["id"]] = [{int(k): v for k, v in (so.get("stats") or {}).items() if v}, sparse(it.get("pseudoStats"))]
for e in db.get("enchants", []):
    # One effect id can be a different enchant per slot (1887 is +7 Agility on bracers, gloves and boots),
    # so names are keyed by effect id, then by item type (1 head ... 13 weapon).
    types = [e.get("type", 0)] + e.get("extraTypes", [])
    for t in types:
        out["enchants"].setdefault(e["effectId"], {})[t] = e.get("name", "")
    st = sparse(e.get("stats"))
    if st:
        for t in types:
            out["enchantStats"].setdefault(e["effectId"], {})[t] = st
    # Per effect id and item type: 1 = can be had in Forever now, 2 = not yet (wowsims' ContentPhaseUnknown, a
    # PTR-only scroll, or held back by hand). Per type because one effect id can be in Forever on one slot only
    # (+15 Strength is a weapon enchant from the Thorium Brotherhood, but on gloves only a PTR scroll).
    # Phase 1 if any entry for that slot is.
    ph = e.get("phase", 1)
    if e.get("itemId") in ptr_items or e["effectId"] in held_enchants:
        ph = 2
    for t in types:
        by = out["enchantPhase"].setdefault(e["effectId"], {})
        by[t] = min(ph, by.get(t, ph))
for s in db.get("spellIcons", []):
    name = s.get("name", "")
    if s.get("rank"):
        name += f" (Rank {s['rank']})"
    out["spells"][s["id"]] = name
for c in db.get("consumables", []):
    for eff in c.get("itemEffects", []):
        if eff.get("buffId"):
            out["consumes"][eff["buffId"]] = [c["id"], c.get("type", 0), c.get("name", "")]
    te = c.get("temporaryEnchant")
    if te and te.get("effectId"):
        out["imbues"][te["effectId"]] = [c["id"], c.get("type", 0), c.get("name", "")]
with open(sys.argv[2], "w") as f:
    json.dump(out, f, separators=(",", ":"))
