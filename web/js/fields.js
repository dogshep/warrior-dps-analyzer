// Field positions of the compact tuples in names.json and upgrades.json, so no code counts positions by hand.
// The producers are scripts/make_names.py (names.items) and scripts/precompute-upgrades.mjs (upgrades items).

// names.items[id] = [name, item type, quality, item level, hand type, weapon speed]
export const ITEM = { NAME: 0, TYPE: 1, QUALITY: 2, ILVL: 3, HAND: 4, SPEED: 5 };
export const ITEM_TYPE_WEAPON = 13; // ITEM.TYPE value (1 head ... 14 ranged)
export const HAND_TWO = 4;          // ITEM.HAND value for a two-hander

// upgrades.json items[id] = [where to get it, faction (0 both, 1 Alliance, 2 Horde), phase, source kinds, date it opens]
export const SRC = { WHERE: 0, FACTION: 1, PHASE: 2, KINDS: 3, OPENS: 4 };
// The letter in SRC.KINDS for an item a profession makes.
export const KIND_CRAFTED = 'c';

// prices.json houses[key].items[id] = [min, median, listed] and, for crafted items, [.., materials cost, unpriced count]
export const PRICE = { MIN: 0, MEDIAN: 1, LISTED: 2, MATERIALS: 3, UNPRICED: 4 };
