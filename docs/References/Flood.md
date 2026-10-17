# Flood

The flood is the gorge's time-pressured hazard (`app/src/game/flood.js`). Its geometry lives in `app/src/world/heightmap.js` (`FLOOD`, `floodMask`, `waterLevelAt`).

## Safe zone (the orange crown)

There is no separate "safe zone" definition. The only dry standing spots at flood height are the gorge roost crowns, built by `app/src/world/roosts.js` and registered as standable discs in `app/src/world/platforms.js`.

- Physics disc: centre `top.x, top.z`, radius 2.4 m, top surface at `top.y` (`i === r.steps ? 2.4 : STEP_R`).
- Visual crown: a cylinder with top radius 2.5 m, centred 0.25 m below `top.y` (so its top face sits at `top.y`), ember-lit (`emissive 0xff5a2a`). This is the orange the player sees.
- Mismatch: the visual is 0.1 m wider than the physics disc. At 2.45 m from the centre the player drops to the tread below (platform ground 6.42 m instead of 7.66 m).

## Heights (measured)

- Base water level `WORLD.waterLevel` = -3.2 m. Peak rise `FLOOD.RISE_MAX` = 9 m, so peak water = 5.8 m.
- Gorge crowns (ROOT CAUSEWAY, THE RAPIDS): top y 7.42 to 7.66 m, so 1.62 to 1.86 m above peak water.
- FALLEN GIANT crowns: top y 15.24 and 21.30 m (9.4 and 15.5 m above peak).
- Damage rule: `hazardAt` is zero unless water is more than 0.9 m above the feet (smoothstep 0.9 to 2.2). A crown is safe at peak by 1.6 m or more; a tread below about 4.9 m feet is the first to hurt.

## Test

`app/tests/floodSafePlatform.test.js` builds the real roost platforms, drives the real flood phase machine to `peak`, stands the player on each roost crown, steps the sim at 60 Hz for 4 s and asserts zero flood damage. A control player in the water 12 m off the crown takes damage. Result at the time of writing: both pass, so no flood code was changed.

## Telemetry

Each flood hit in `damageTaken` carries `feetY` (the player's feet), `waterY` (the water surface at that spot), `depth` (`waterY - feetY`) and `onCrown` (feet standing on a registered platform disc). `damagePlayer` (`app/src/game/sim.js`, flood branch) passes the water sample point `{x, y: waterY, z}` as `srcPos` plus these values as a `detail` argument that `main.js` `onHurt` spreads into the telemetry entry. `analyzeSession.mjs` prints them as a "Flood death" line when the run ended in the flood. Pinned by `app/tests/floodTelemetry.test.js`.

## Open

The death line shows only the last hit's source. Damage taken while wading before reaching a crown is not separated from the final tick, so the death in DF-158 cannot be proven to occur on the crown from telemetry alone.
