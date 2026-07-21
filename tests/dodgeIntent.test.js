import { describe, it, expect } from 'vitest';
import { computeDodgeIntent } from '../src/game/autotest.js';

function enemy(overrides) {
  return Object.assign({
    type: 'prowler', state: 'hunt', pos: { x: 0, y: 0, z: 0 }, heading: 0,
  }, overrides);
}

// yaw 0 => facing (0,0,-1), i.e. "north" (matches the route waypoints,
// which run from high +Z at insertion down toward negative Z at extraction)

describe('computeDodgeIntent: juggernaut melee windup (root cause 1, bot-side)', () => {
  it('backs away (walk-speed retreat) from a windup juggernaut standing ahead', () => {
    // enemy 2m north (ahead, same direction the player faces) - correct
    // reaction is to retreat (moveZ > 0, backpedal - cannot sprint backward,
    // matching the same FPS convention every human player is bound by)
    const jug = enemy({ type: 'juggernaut', state: 'windup', pos: { x: 0, y: 0, z: -2 } });
    const dodge = computeDodgeIntent([jug], { x: 0, y: 0, z: 0 }, 0);
    expect(dodge).not.toBeNull();
    expect(dodge.moveZ).toBeGreaterThan(0);
    expect(Math.abs(dodge.moveX)).toBeLessThan(0.1);
  });

  it('sprints away (forward) from a windup juggernaut standing behind', () => {
    // enemy 2m south (behind the player) - moving away means moving
    // FORWARD relative to facing, which is sprint-eligible
    const jug = enemy({ type: 'juggernaut', state: 'windup', pos: { x: 0, y: 0, z: 2 } });
    const dodge = computeDodgeIntent([jug], { x: 0, y: 0, z: 0 }, 0);
    expect(dodge).not.toBeNull();
    expect(dodge.moveZ).toBeLessThan(0);
    expect(dodge.sprint).toBe(true);
  });

  it('does nothing for a juggernaut that is only hunting (no windup yet)', () => {
    const jug = enemy({ type: 'juggernaut', state: 'hunt', pos: { x: 0, y: 0, z: -2 } });
    const dodge = computeDodgeIntent([jug], { x: 0, y: 0, z: 0 }, 0);
    expect(dodge).toBeNull();
  });

  it('ignores a windup juggernaut far outside melee range', () => {
    const jug = enemy({ type: 'juggernaut', state: 'windup', pos: { x: 0, y: 0, z: -40 } });
    const dodge = computeDodgeIntent([jug], { x: 0, y: 0, z: 0 }, 0);
    expect(dodge).toBeNull();
  });

  it('still dodges a charging juggernaut sideways (existing behaviour preserved)', () => {
    const jug = enemy({
      type: 'juggernaut', state: 'charge', pos: { x: 5, y: 0, z: 0 }, heading: Math.PI / 2,
    });
    const dodge = computeDodgeIntent([jug], { x: 0, y: 0, z: 0 }, 0);
    expect(dodge).not.toBeNull();
    expect(Math.abs(dodge.moveX)).toBe(1);
    expect(dodge.moveZ).toBe(0.4);
  });

  it('still dodges a pouncing shrike (existing behaviour preserved)', () => {
    const shrike = enemy({
      type: 'shrike', state: 'air', pouncing: true, pos: { x: 3, y: 0, z: 0 }, heading: 0,
    });
    const dodge = computeDodgeIntent([shrike], { x: 0, y: 0, z: 0 }, 0);
    expect(dodge).not.toBeNull();
  });

  it('returns null when nothing is attacking', () => {
    const p = enemy({ type: 'prowler', state: 'hunt', pos: { x: 3, y: 0, z: 0 } });
    const dodge = computeDodgeIntent([p], { x: 0, y: 0, z: 0 }, 0);
    expect(dodge).toBeNull();
  });
});
