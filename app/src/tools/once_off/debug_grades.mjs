// Round-3 world debug: print terrain height + step grade along problem lines
// so wall/ramp constants can be tuned against numbers, not guesses.
import {
  WORLD, terrainHeight, fractureZ, gorgeZ, palisadeZ, blockedStep, isThicket, MAX_GRADE,
} from '../../world/heightmap.js';

function probe(label, ax, az, bx, bz, step = 0.65) {
  const dist = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / dist;
  const dz = (bz - az) / dist;
  console.log(`\n=== ${label} (dir ${dx.toFixed(2)},${dz.toFixed(2)}) ===`);
  let prevH = terrainHeight(ax, az);
  let worst = -99;
  let worstAt = null;
  for (let t = step; t <= dist; t += step) {
    const x = ax + dx * t;
    const z = az + dz * t;
    const h = terrainHeight(x, z);
    const grade = (h - prevH) / step;
    const blocked = blockedStep(x - dx * step, z - dz * step, dx, dz, prevH);
    if (grade > worst) {
      worst = grade;
      worstAt = { x: +x.toFixed(1), z: +z.toFixed(1) };
    }
    if (blocked || grade > MAX_GRADE * 0.85) {
      console.log(`  x=${x.toFixed(1)} z=${z.toFixed(1)} h=${h.toFixed(2)} grade=${grade.toFixed(2)}${blocked ? ' BLOCKED' : ''}${isThicket(x, z) ? ' THICKET' : ''}`);
    }
    prevH = h;
  }
  console.log(`  worst grade ${worst.toFixed(2)} at ${JSON.stringify(worstAt)}`);
}

// 1. fracture at x=-28 (should be blocked but test says climbable)
{
  const fz = fractureZ(-28);
  probe(`fracture x=-28 north (fz=${fz.toFixed(1)})`, -28, fz + 26, -28, fz - 26);
}
// 2. retreat south at x=120 (blocked at z=-196.9, should be free)
{
  const fz = fractureZ(120);
  probe(`retreat x=120 south (fz=${fz.toFixed(1)})`, 120, fz - 26, 120, fz + 26);
}
// 3. scree x=148 north (blocked at z=-187.5, should be free)
{
  const fz = fractureZ(148);
  probe(`scree x=148 north (fz=${fz.toFixed(1)})`, 148, fz + 30, 148, fz - 30);
}
// 4. river leg (13.0,95)->(15.8,70) blocked at (13.5,90.2)
probe('river leg z95->70', 13.0, 95, 15.8, 70);
// 5. maw east exit blocked at (46.8,-252)
probe('maw east exit', WORLD.maw.x, WORLD.maw.z, WORLD.maw.x + WORLD.maw.r + 18, WORLD.maw.z);
