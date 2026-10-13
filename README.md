# Deadfall

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/G2G31WKOCN)

**A first-person PVE extraction shooter in an Amazonian fever-dream that hunts you back - in your browser.**

![Deadfall: a violet-sky jungle of dark canopy trees, glowing spires and drifting jellyfish](docs/Images/screenshot.jpg)

One run, one question: which way north? Insert at the southern treeline and pick your way through a world that is all walls and choices - a mountain Palisade with three gates, a flooded razorfin gorge with three sills, a highlands cliff with two ways up - while storms, fog banks and the threat director hunt you. At the end, a flooded moat, the thing that lives in it, and one drowned stair to the extraction beacon. Die or extract - either way the run is a complete story.

## Play

Requirements: [Node.js](https://nodejs.org) 18 or newer, and a modern browser.

On Windows, double-click `scripts\launch.bat`. It installs dependencies on the first run, starts the game and opens it in your browser.

On any platform:

```
npm install
npm run dev        # opens on http://localhost:5199
```

## Controls

WASD move · mouse look · **RMB aim down sights** · Shift sprint · LMB fire · R reload · 1/2/3/Q weapons · G grenade (hold to arc, release to throw) · V machete · Space jump · ESC pause

## Difficulties

Three difficulties: **RECRUIT** (learn the jungle), **HUNTER** (the intended run), **DEADFALL** (extraction is a rumour).

## What awaits you

- Geography is the antagonist: mountain walls, a flooded gorge and cliffs force every route into a choice.
- The Miremother, an apex serpent that guards the drowned stair to extraction.
- Live weather that plays: storms hide your gunfire, fog ruins the hunters' tracking.
- A deceptive jungle of flowers, bone traps and dart totems that punish trust.
- Six hunters, each with a tell and a weakpoint worth finding.
- A threat director that reacts to your noise and progress instead of ticking spawn timers.
- An arsenal with opinions: carbine, pump breacher, the empty-handed LONGARM, grenades and a machete.
- Ayahuasca, a real trip: the world warps and every creature glows through the foliage.

The full tour is in [docs/References/GameFeatures.md](docs/References/GameFeatures.md).

## For developers

- [docs/References/DevContext.md](docs/References/DevContext.md): index of every doc, folder map, how to run tests, rules and invariants.
- [docs/Guides/HeadlessPlaytest.md](docs/Guides/HeadlessPlaytest.md): the headless bot and the `window.__deadfall` API.
- [docs/Guides/ScreenshotRig.md](docs/Guides/ScreenshotRig.md): deterministic before/after screenshots for art changes.
- [docs/References/Engineering.md](docs/References/Engineering.md): how the game is built.
- [docs/References/GameFeatures.md](docs/References/GameFeatures.md): everything in the jungle.

`npm test` runs the unit suite.

*Built with Claude: round 1 (2026-07-11) was one autonomous session; later rounds answered human playtests with real challenge, FPS feel, the fever-dream look, the headless tooling, physical geography, the Miremother, live weather, the deception layer and the trip.*

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Free to play, study and modify for noncommercial use; selling it or building a commercial service on it is not permitted. Textures in `assets/textures/` are CC0 from ambientCG (see `assets/textures/CREDITS.md`).
