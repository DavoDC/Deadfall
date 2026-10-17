# Flood

The flood is the gorge's time-pressured hazard (`app/src/game/flood.js`). Its geometry lives in `app/src/world/heightmap.js` (`FLOOD`, `floodMask`, `waterLevelAt`).

## Safe zone (the orange crown)

There is no separate "safe zone" definition. The only dry standing spots at flood height are the gorge roost crowns, built by `app/src/world/roosts.js` and registered as standable discs in `app/src/world/platforms.js`.

- Physics disc: centre `top.x, top.z`, radius `CROWN_R` = 2.5 m, top surface at `top.y` (`i === r.steps ? CROWN_R : STEP_R`).
- Visual crown: a cylinder with top radius 2.5 m, centred 0.25 m below `top.y` (so its top face sits at `top.y`), ember-lit (`emissive 0xff5a2a`). This is the orange the player sees.
- Cause of the DF-158 "died on the platform" report: the physics disc was 2.4 m while the crown is drawn 2.5 m wide, so a player at the visible edge (2.45 m from the centre) dropped to the tread below (platform ground 6.42 m instead of 7.66 m) and into the water. Fixed: the disc is now `CROWN_R` = 2.5 m, the same constant the visual uses, so the two cannot drift apart.

## Heights (measured)

- Base water level `WORLD.waterLevel` = -3.2 m. Peak rise `FLOOD.RISE_MAX` = 9 m, so peak water = 5.8 m.
- Gorge crowns (ROOT CAUSEWAY, THE RAPIDS): top y 7.42 to 7.66 m, so 1.62 to 1.86 m above peak water.
- FALLEN GIANT crowns: top y 15.24 and 21.30 m (9.4 and 15.5 m above peak).
- Damage rule: `hazardAt` is zero unless water is more than 0.9 m above the feet (smoothstep 0.9 to 2.2). A crown is safe at peak by 1.6 m or more; a tread below about 4.9 m feet is the first to hurt.

## Test

`app/tests/floodSafePlatform.test.js` builds the real roost platforms, drives the real flood phase machine to `peak`, stands the player on each roost crown, steps the sim at 60 Hz for 4 s and asserts zero flood damage. A control player in the water 12 m off the crown takes damage. A third test stands 2.45 m from each crown centre at peak flood and asserts the crown disc is under the feet and zero flood damage (it fails with a 2.4 m disc).

## Telemetry

Each flood hit in `damageTaken` carries `feetY` (the player's feet), `waterY` (the water surface at that spot), `depth` (`waterY - feetY`) and `onCrown` (feet standing on a registered platform disc). `damagePlayer` (`app/src/game/sim.js`, flood branch) passes the water sample point `{x, y: waterY, z}` as `srcPos` plus these values as a `detail` argument that `main.js` `onHurt` spreads into the telemetry entry. `analyzeSession.mjs` prints them as a "Flood death" line when the run ended in the flood. Pinned by `app/tests/floodTelemetry.test.js`.
