"""Writes the slim lookup tables the page uses from wowsims' db.json: item names and slots, enchant names and phases,
spell names, and which aura (buff) ids belong to which consumable."""
import json, sys

db = json.load(open(sys.argv[1]))
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
    for t in [e.get("type", 0)] + e.get("extraTypes", []):
        out["enchants"].setdefault(e["effectId"], {})[t] = e.get("name", "")
    # 1 = can be had in Forever now, 2 = not yet (wowsims' ContentPhaseUnknown). Phase 1 if any entry is.
    st = sparse(e.get("stats"))
    if st:
        for t in [e.get("type", 0)] + e.get("extraTypes", []):
            out["enchantStats"].setdefault(e["effectId"], {})[t] = st
    ph = e.get("phase", 1)
    out["enchantPhase"][e["effectId"]] = min(ph, out["enchantPhase"].get(e["effectId"], ph))
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
json.dump(out, open(sys.argv[2], "w"), separators=(",", ":"))
