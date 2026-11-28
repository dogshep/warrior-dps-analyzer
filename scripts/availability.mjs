// Reads data/forever-availability.json, the one hand-kept list of what WoW Forever does not have yet on top of
// wowsims' own phase flags, for the build scripts (scripts/make_names.py reads the same file for enchants).
import { readFileSync } from 'node:fs';

export const AVAIL = JSON.parse(readFileSync(new URL('../data/forever-availability.json', import.meta.url)));
const realKeys = o => Object.keys(o || {}).filter(k => !k.startsWith('_')).map(Number);
// Items never to suggest.
export const HELD_ITEMS = new Set(realKeys(AVAIL.itemsNotInForever));
const LATER = (AVAIL.opensLater || []).map(e => ({ date: e.date, factions: new Set(realKeys(e.factions)), quests: new Set(realKeys(e.quests)), zones: new Set(realKeys(e.zones)), items: new Set(realKeys(e.items)) }));

// The date (YYYY-MM-DD) an item from wowsims' db.json can first be had in Forever, from the dated entries of the
// list, or '' when it can be had now. An item the entry names is held back whatever its sources. A reputation source is the standing a vendor asks for on top of the vendor, so
// a held-back faction alone holds the item back; otherwise every one of its sources must be held back.
export function opensOn(it) {
  const src = it.sources || [];
  let latest = '';
  for (const e of LATER) {
    const repHeld = s => !!s.rep && e.factions.has(s.rep.repFactionId);
    const held = s => repHeld(s) || (!!s.quest && (e.quests.has(s.quest.id) || e.zones.has(s.quest.zoneId))) || (!!s.drop && e.zones.has(s.drop.zoneId));
    if ((e.items.has(it.id) || src.some(repHeld) || (src.length && src.every(held))) && e.date > latest) latest = e.date;
  }
  return latest;
}
