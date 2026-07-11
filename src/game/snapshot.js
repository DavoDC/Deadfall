// Serializable game-state snapshot - the multiplayer seam.
//
// Deadfall's simulation is already network-shaped:
//   - the player controller consumes INTENTS (plain objects), never raw
//     events - a remote peer is just another intent source (input.js)
//   - every entity's gameplay state lives in plain fields (positions,
//     hp, AI state strings), with three.js objects as pure views
//   - all world geometry derives from WORLD.seed - peers that share a
//     seed share the exact map for free; only dynamic state needs syncing
//
// A future co-op layer (Trystero-style serverless WebRTC, see the
// Echobound repo) drops in as: host runs the sim exactly as today,
// broadcasts snapshot() at a modest tick rate, peers send their intents
// back and render from snapshots. No engine rewrite required.
//
// snapshot() intentionally captures ONLY what a peer cannot derive.

export function createSnapshot(ctx) {
  const { player, weapons, enemyMgr, director, game } = ctx;

  function snapshot() {
    return {
      seed: ctx.seed,
      t: game.time,
      state: game.state,
      kills: game.kills,
      players: [
        {
          id: 0,
          x: player.p.pos.x,
          y: player.p.pos.y,
          z: player.p.pos.z,
          yaw: player.p.yaw,
          pitch: player.p.pitch,
          hp: player.p.hp,
          alive: player.p.alive,
          weapon: weapons.state.current,
          mag: { ...weapons.state.mag },
          reserve: { ...weapons.state.reserve },
        },
      ],
      enemies: enemyMgr.enemies
        .filter((e) => !e.dead)
        .map((e, i) => ({
          id: i,
          type: e.type,
          x: e.pos.x,
          y: e.pos.y,
          z: e.pos.z,
          heading: e.heading,
          hp: e.hp,
          state: e.state,
        })),
      director: {
        time: director.state.time,
        heat: director.state.heat,
        surge: director.state.surge,
        budget: director.state.budget,
      },
      extraction: {
        progress: ctx.extraction.progress,
        committed: ctx.extraction.committed,
      },
    };
  }

  return { snapshot };
}
