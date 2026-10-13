<div align="center">

# Deadfall

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/G2G31WKOCN)

**A first-person PVE extraction shooter in an Amazonian fever-dream that hunts you back - in your browser.**

<img src="docs/Images/screenshot.jpg" alt="Deadfall title screen: the DEADFALL logo over a murky jungle swamp, with the three difficulty cards and the Deploy button" width="800">

One run. No second chances.<br>
The jungle is awake, and it knows you are here.<br>
Find your way north to the beacon, and get out alive.

</div>

## Play

Requirements: Windows 10 or 11, a modern browser (Brave, Chrome, Edge or Firefox), and Node.js 18 or newer (`launch.bat` installs Node for you if it is missing).

1. **Download this repo:** click the green `<> Code` button at the top of the GitHub page, then **Download ZIP**, and unzip it anywhere (right-click, Extract All).
2. **Double-click `scripts\launch.bat`.** First run installs what the game needs (a minute or two), then it starts the game and opens it in your browser. Next time it starts straight away.

Good to know: Windows may say "unknown publisher" the first time. Click **More info**, then **Run anyway**. The browser tab can stay blank for a few seconds while the game starts. To quit, close the black launcher window.

**Updating:** download the ZIP again, or just double-click `scripts\update.bat`. Your game progress lives in your browser, so updating never loses it.

On macOS or Linux: install [Node.js](https://nodejs.org) 18 or newer, then run `npm install` and `npm run dev` inside the `app` folder.

Details: [docs/Guides/LaunchAndUpdate.md](docs/Guides/LaunchAndUpdate.md).

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

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Free to play, study and modify for noncommercial use; selling it or building a commercial service on it is not permitted. Textures in `app/assets/textures/` are CC0 from ambientCG (see `app/assets/textures/CREDITS.md`).
