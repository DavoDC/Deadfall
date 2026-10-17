import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/audio/engine.js', () => ({
  sfxCreature: vi.fn(),
  sfxAcidSpit: vi.fn(),
  sfxAcidSplat: vi.fn(),
  sfxBloomPulse: vi.fn(),
  sfxMimicShriek: vi.fn(),
}));

import * as THREE from 'three';
import { createEnemyManager, stepYawToward, visualHeading } from '../src/enemies/enemies.js';
import { WORLD, terrainHeight } from '../src/world/heightmap.js';

// open ground at the insertion point (the origin is not walkable terrain)
const OX = WORLD.insertion.x;
const OZ = WORLD.insertion.z;

function makeManager() {
  const scene = { add() {} };
  const players = [{ pos: new THREE.Vector3(OX, terrainHeight(OX, OZ), OZ), vel: new THREE.Vector3() }];
  const mgr = createEnemyManager(scene, { nearestPlayer: () => players[0], players }, { burst() {} }, {
    damagePlayer: vi.fn(),
    onKill: vi.fn(),
    onSummon: vi.fn(),
  });
  return { mgr, player: players[0] };
}

// Models are authored facing -Z; the group is drawn at rotation.y. The
// world direction the face points along is therefore (-sin, -cos) of it.
function faceDir(e) {
  const y = e.model.group.rotation.y;
  return { x: -Math.sin(y), z: -Math.cos(y) };
}

function dotToPlayer(e, player) {
  const dx = player.pos.x - e.pos.x;
  const dz = player.pos.z - e.pos.z;
  const len = Math.hypot(dx, dz);
  const f = faceDir(e);
  return (f.x * dx + f.z * dz) / len;
}

function run(mgr, e, frames) {
  for (let i = 0; i < frames; i++) {
    e.losTimer = 99; // keep the forced hasLOS
    e.hasLOS = true;
    mgr.update(1 / 60);
  }
}

describe('spitter facing', () => {
  it('stepYawToward takes the short way round and caps the step', () => {
    expect(stepYawToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(stepYawToward(3, -3, 10)).toBeCloseTo(-3 + Math.PI * 2);
    expect(visualHeading({ heading: 2 })).toBe(2);
    expect(visualHeading({ heading: 2, faceYaw: 1 })).toBe(1);
  });

  it('faces the player through the windup, not away', () => {
    const { mgr, player } = makeManager();
    const e = mgr.spawn('spitter', OX + 20, OZ);
    e.heading = Math.PI / 2; // looking away: toward +x
    e.faceYaw = undefined;
    e.attackCd = 0;
    run(mgr, e, 90);
    expect(dotToPlayer(e, player)).toBeGreaterThan(0.95);
  });

  it('keeps its face on the player while backing away', () => {
    const { mgr, player } = makeManager();
    const e = mgr.spawn('spitter', OX + 6, OZ); // inside keepMin: retreats
    e.attackCd = 99;
    const startX = e.pos.x;
    run(mgr, e, 90);
    expect(e.pos.x).toBeGreaterThan(startX); // it did back off
    expect(dotToPlayer(e, player)).toBeGreaterThan(0.95);
  });
});
