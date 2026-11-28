// Field positions of the compact tuples in names.json and upgrades.json, so no code counts positions by hand.
// The producers are scripts/make_names.py (names.items) and scripts/precompute-upgrades.mjs (upgrades items).

// names.items[id] = [name, item type, quality, item level, hand type, weapon speed]
export const ITEM = { NAME: 0, TYPE: 1, QUALITY: 2, ILVL: 3, HAND: 4, SPEED: 5 };
export const ITEM_TYPE_WEAPON = 13; // ITEM.TYPE value (1 head ... 14 ranged)
export const ITEM_TYPE_BACK = 4;
export const ITEM_TYPE_RANGED = 14;
// ITEM.HAND values (wowsims' handType)
export const HAND = { MAIN: 1, ONE: 2, OFF: 3, TWO: 4 };
export const HAND_TWO = HAND.TWO;
// Item types 1 to 10 are the armor pieces worn on the body (head ... feet).
export const isBodyArmor = t => t >= 1 && t <= 10;

// upgrades.json items[id] = [where to get it, faction (0 both, 1 Alliance, 2 Horde), phase, source kinds, date it opens]
export const SRC = { WHERE: 0, FACTION: 1, PHASE: 2, KINDS: 3, OPENS: 4 };
// The source kinds, in the order of the letters in SRC.KINDS and of the checkboxes in index.html (a test keeps
// those in step). tag: the small label on an upgrade.
export const SOURCE_KINDS = [
  { key: 'd', tag: 'Dungeon' }, { key: 'r', tag: 'Raid' }, { key: 'c', tag: 'Crafted' }, { key: 'q', tag: 'Quest' },
  { key: 'v', tag: 'Vendor' }, { key: 'f', tag: 'Reputation' }, { key: 'p', tag: 'PvP' },
];
export const KIND_KEYS = SOURCE_KINDS.map(k => k.key).join('');
// The letter in SRC.KINDS for an item a profession makes.
export const KIND_CRAFTED = 'c';
// Whether an upgrades.json item row is a crafted one.
export const isCrafted = meta => String(meta?.[SRC.KINDS] || '').includes(KIND_CRAFTED);

// prices.json houses[key].items[id] = [min, median, listed] and, for crafted items, [.., materials cost, unpriced count]
export const PRICE = { MIN: 0, MEDIAN: 1, LISTED: 2, MATERIALS: 3, UNPRICED: 4 };
