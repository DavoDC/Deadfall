// Probe the drowned stair: heights + step grades from the Maw floor up the
// ramp centreline to the mesa top, and around the blocked point.
import { WORLD, terrainHeight, blockedStep, MAX_GRADE } from '../../world/heightmap.js';

const ex = WORLD.extraction;
const stairAz = Math.atan2(WORLD.maw.x - ex.x, WORLD.maw.z - ex.z);
const ux = Math.sin(stairAz);
const uz = Math.cos(stairAz);
console.log(`stairAz=${stairAz.toFixed(3)} u=(${ux.toFixed(3)},${uz.toFixed(3)})`);

console.log('\ncentreline d=70 -> 0 (walking toward mesa centre):');
let prev = null;
for (let d = 70; d >= 0; d -= 1) {
  const x = ex.x + ux * d;
  const z = ex.z + uz * d;
  const h = terrainHeight(x, z);
  const grade = prev === null ? 0 : (h - prev);
  const blocked = blockedStep(x + ux, z + uz, -ux, -uz, terrainHeight(x + ux, z + uz));
  if (Math.abs(grade) > 1.0 || blocked || d % 5 === 0) {
    console.log(`  d=${String(d).padStart(2)} (${x.toFixed(1)},${z.toFixed(1)}) h=${h.toFixed(2)} grade/m=${grade.toFixed(2)}${blocked ? ' BLOCKED' : ''}`);
  }
  prev = h;
}

console.log('\nleg (44,-274)->(58,-284) fine scan:');
const dx = 14 / Math.hypot(14, 10);
const dz = -10 / Math.hypot(14, 10);
prev = terrainHeight(44, -274);
for (let t = 0.65; t <= 17.3; t += 0.65) {
  const x = 44 + dx * t;
  const z = -274 + dz * t;
  const h = terrainHeight(x, z);
  const grade = (h - prev) / 0.65;
  const blocked = blockedStep(x - dx * 0.65, z - dz * 0.65, dx, dz, prev);
  console.log(`  (${x.toFixed(1)},${z.toFixed(1)}) h=${h.toFixed(2)} grade=${grade.toFixed(2)}${blocked ? ' BLOCKED' : ''}`);
  prev = h;
}
