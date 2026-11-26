"""Writes the slim lookup tables the page uses from wowsims' db.json: item names and slots, enchant names,
spell names, and which aura (buff) ids belong to which consumable."""
import json, sys

db = json.load(open(sys.argv[1]))
out = {"items": {}, "enchants": {}, "spells": {}, "consumes": {}, "imbues": {}}
for it in db.get("items", []):
    so = (it.get("scalingOptions") or {}).get("0", {})
    # [name, item type, quality, ilvl, hand type (4 = two-hand), weapon speed]
    out["items"][it["id"]] = [it.get("name", ""), it.get("type", 0), it.get("quality", 0), so.get("ilvl", 0), it.get("handType", 0), it.get("weaponSpeed", 0)]
for e in db.get("enchants", []):
    out["enchants"][e["effectId"]] = e.get("name", "")
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
