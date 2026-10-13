// Authored route encounters: the jungle shows you its whole bestiary on the
// way north, whichever difficulty you pick and whichever route you take.
//
// The threat director is reactive (time, noise, progress), which on a quick or
// quiet run can leave long empty stretches and never show some hunters at all.
// This table is the guarantee on top of it: each SLOT fires once when the
// furthest-north player passes `at` (the fraction of the way from the
// insertion to the extraction, the same measure as director.progressNorth) and
// the director places that slot's group AHEAD of the player, out of sight.
//
// Per-difficulty counts live here, in data. RECRUIT (easy) keeps the same
// variety but smaller groups; the late dangerous types stay late. Slots are
// spaced about 12 percent apart, the first at 7-8 percent so contact is early,
// and every hunter has appeared by 67 percent (the mixed pack at 77 percent
// is extra pressure, not a requirement). `foreshadow` slots spawn nothing:
// they cue the apex that waits in the Sunken Maw before the drowned stair
// (progress 0.86 is about 80 percent of the walked route, the stair starts
// near 87 percent). `at` is progress by latitude, so on the winding routes
// the walked-route percent runs a few points behind it.
//
// Pure data and pure helpers, unit-tested in tests/routeEncounters.test.js.

export const HUNTER_TYPES = ['prowler', 'stingerwing', 'spitter', 'shrike', 'bloomcaller', 'juggernaut'];

// keys are difficulty keys (difficulty.js): easy = RECRUIT, normal = HUNTER, hard = DEADFALL
export const ROUTE_SLOTS = [
  {
    id: 'first-contact', at: { easy: 0.08, normal: 0.07, hard: 0.06 },
    group: {
      easy: [['prowler', 1]],
      normal: [['prowler', 2]],
      hard: [['prowler', 2]],
    },
  },
  {
    id: 'wing-swarm', at: 0.17,
    group: {
      easy: [['stingerwing', 3]],
      normal: [['stingerwing', 3]],
      hard: [['stingerwing', 4]],
    },
  },
  {
    id: 'flora', at: 0.25, flora: { easy: 1, normal: 2, hard: 2 },
  },
  {
    id: 'spit', at: 0.31,
    group: {
      easy: [['spitter', 1]],
      normal: [['spitter', 1]],
      hard: [['spitter', 1], ['prowler', 1]],
    },
  },
  {
    id: 'caller', at: 0.43,
    group: {
      easy: [['bloomcaller', 1], ['prowler', 1]],
      normal: [['bloomcaller', 1], ['prowler', 1]],
      hard: [['bloomcaller', 1], ['prowler', 2]],
    },
  },
  {
    id: 'canopy', at: 0.55,
    group: {
      easy: [['shrike', 1]],
      normal: [['shrike', 1]],
      hard: [['shrike', 2]],
    },
  },
  {
    id: 'flora-deep', at: 0.6, flora: { easy: 1, normal: 2, hard: 3 },
  },
  {
    id: 'bulwark', at: 0.67,
    group: {
      easy: [['juggernaut', 1]],
      normal: [['juggernaut', 1]],
      hard: [['juggernaut', 1], ['stingerwing', 2]],
    },
  },
  {
    id: 'last-pack', at: 0.77,
    group: {
      easy: [['prowler', 1], ['stingerwing', 3]],
      normal: [['prowler', 2], ['spitter', 1], ['stingerwing', 1]],
      hard: [['prowler', 2], ['spitter', 1], ['shrike', 1]],
    },
  },
  // the apex is never spawned early (the Maw is her lair); her presence is
  // cued from afar before the drowned stair: roar over the water, a toast
  { id: 'apex-foreshadow', at: 0.86, foreshadow: 'apex' },
];

function pick(v, diffKey) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v[diffKey] ?? v.normal;
  return v;
}

// trigger fraction of a slot on a difficulty
export function slotAt(slot, diffKey) {
  return pick(slot.at, diffKey);
}

// [[type, count], ...] for a slot on a difficulty ([] for flora/foreshadow slots)
export function slotGroup(slot, diffKey) {
  return slot.group ? pick(slot.group, diffKey) : [];
}

// number of dormant flora to plant for a flora slot (0 otherwise)
export function slotFlora(slot, diffKey) {
  return slot.flora ? pick(slot.flora, diffKey) : 0;
}

// total enemies a difficulty's slots bring (flora counted separately)
export function slotEnemyTotal(diffKey) {
  let n = 0;
  for (const s of ROUTE_SLOTS) for (const [, c] of slotGroup(s, diffKey)) n += c;
  return n;
}

// slots in ROUTE_SLOTS order whose trigger lies in (prev, now]
export function slotsCrossed(prev, now, diffKey) {
  return ROUTE_SLOTS.filter((s) => {
    const at = slotAt(s, diffKey);
    return at > prev && at <= now;
  });
}
