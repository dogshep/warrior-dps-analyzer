// The 17 equipment slots, in the order wowsims' EquipmentSpec wants them (0 head ... 16 ranged). Everything that
// is per slot lives in this one table, so the other files read it instead of keeping their own lists.
//   name: shown on the page. pool: the key of its item list in upgrades.json (rings and trinkets share one for both
//   slots). itemType: the item type wowsims gives items for it. log: its index in the combat log's gear list
//   (inventory slot 1..19, 0-based). pair: the slot worn beside it, which a unique item can't also be in.
export const SLOTS = [
  { name: 'Head', pool: 'head', itemType: 1, log: 0 },
  { name: 'Neck', pool: 'neck', itemType: 2, log: 1 },
  { name: 'Shoulder', pool: 'shoulder', itemType: 3, log: 2 },
  { name: 'Back', pool: 'back', itemType: 4, log: 14 },
  { name: 'Chest', pool: 'chest', itemType: 5, log: 4 },
  { name: 'Wrist', pool: 'wrist', itemType: 6, log: 8 },
  { name: 'Hands', pool: 'hands', itemType: 7, log: 9 },
  { name: 'Waist', pool: 'waist', itemType: 8, log: 5 },
  { name: 'Legs', pool: 'legs', itemType: 9, log: 6 },
  { name: 'Feet', pool: 'feet', itemType: 10, log: 7 },
  { name: 'Ring 1', pool: 'ring', itemType: 11, log: 10, pair: 11 },
  { name: 'Ring 2', pool: 'ring', itemType: 11, log: 11, pair: 10 },
  { name: 'Trinket 1', pool: 'trinket', itemType: 12, log: 12, pair: 13 },
  { name: 'Trinket 2', pool: 'trinket', itemType: 12, log: 13, pair: 12 },
  { name: 'Main hand', pool: 'mh', itemType: 13, log: 15, pair: 15 },
  { name: 'Off hand', pool: 'oh', itemType: 13, log: 16, pair: 14 },
  { name: 'Ranged', pool: 'ranged', itemType: 14, log: 17 },
];

export const SLOT_MH = 14;
export const SLOT_OH = 15;

export const SLOT_NAMES = SLOTS.map(s => s.name);
export const SLOT_ITEM_TYPE = SLOTS.map(s => s.itemType);
export const LOG_TO_SIM_SLOTS = SLOTS.map(s => s.log);
export const SLOT_KEY = SLOTS.map(s => s.pool);
// slot -> the slot worn beside it (rings, trinkets and the two weapon hands only).
export const PAIR = Object.fromEntries(SLOTS.flatMap((s, i) => (s.pair === undefined ? [] : [[i, s.pair]])));
// pool key -> its first slot.
export const SLOT_POOLS = {};
SLOTS.forEach((s, i) => { SLOT_POOLS[s.pool] ??= i; });

// The pool for an armor, ring or trinket item type (1 head ... 12 trinket).
export const poolOfItemType = t => SLOTS.find(s => s.itemType === t)?.pool;
// Rings and trinkets: a new one replaces the weaker of the two worn.
export const isRingOrTrinket = slot => SLOTS[slot].itemType === 11 || SLOTS[slot].itemType === 12;
// Main hand, off hand and ranged: their value depends on speed and procs, so weights alone misjudge them.
export const isWeaponSlot = slot => slot >= SLOT_MH;
