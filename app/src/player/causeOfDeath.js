// Plain uppercase name for the damage source of the last hit (sim.js damagePlayer
// source), shown as KILLED BY on the K.I.A. screen. Enemy ids read as their name
// (shrike -> SHRIKE); the few sources that are not an enemy id get a clear name.

const NAMES = {
  flood: 'FLOOD',
  acid: 'ACID',
  'jugg-charge': 'JUGGERNAUT',
  'spitter-bite': 'SPITTER',
  'grenade-self': 'OWN GRENADE',
  snapjaw: 'SNAP TRAP',
  dart: 'DART TRAP',
};

export function causeLabel(source) {
  if (!source || source === 'unknown') return 'UNKNOWN';
  if (NAMES[source]) return NAMES[source];
  return String(source).replace(/[-_]+/g, ' ').trim().toUpperCase();
}
