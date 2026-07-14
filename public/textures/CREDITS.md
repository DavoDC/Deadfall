# Texture Credits & License Information

**All textures in this directory are CC0 Public Domain.** No attribution required. Safe for commercial use, including Steam.

## Status

**Current textures (as of 2026-07-14):** Real CC0 PBR texture sets, downloaded and integrated. Total size: 15 MB (25 MB budget).

---

## Sources (verified by direct download - not speculative)

All six sets below were downloaded directly from ambientCG's asset API
(`https://ambientcg.com/get?file=<AssetID>_1K-JPG.zip`) at 1K resolution,
then re-encoded locally: diffuse/roughness/ao re-compressed as JPG (quality
~75-80) to control file size, normal maps kept as lossless PNG. ambientCG
publishes all assets as CC0 (public domain) - see https://ambientcg.com/faq
("All assets ... are released under the Creative Commons CC0 License").

### bark-01
- Source: ambientCG "Bark012" - https://ambientcg.com/a/Bark012
- Direct download used: https://ambientcg.com/get?file=Bark012_1K-JPG.zip
- Maps: diffuse.jpg, normal.png, roughness.jpg, ao.jpg
- Resolution: 1K (1024x1024)
- License: CC0

### bark-02
- Source: ambientCG "Bark013" (moss-covered bark, for contrast with bark-01) - https://ambientcg.com/a/Bark013
- Direct download used: https://ambientcg.com/get?file=Bark013_1K-JPG.zip
- Maps: diffuse.jpg, normal.png, roughness.jpg, ao.jpg
- Resolution: 1K (1024x1024)
- License: CC0

### foliage
- Source: ambientCG "ScatteredLeaves008" (forest-floor leaf litter) - https://ambientcg.com/a/ScatteredLeaves008
- Direct download used: https://ambientcg.com/get?file=ScatteredLeaves008_1K-JPG.zip
- Maps: diffuse.jpg, normal.png, roughness.jpg, ao.jpg
- Resolution: 1K (1024x1024)
- License: CC0

### mud
- Source: ambientCG "Ground036" (dirt/mud with organic variation) - https://ambientcg.com/a/Ground036
- Direct download used: https://ambientcg.com/get?file=Ground036_1K-JPG.zip
- Maps: diffuse.jpg, normal.png, roughness.jpg, ao.jpg
- Resolution: 1K (1024x1024)
- License: CC0

### rock
- Source: ambientCG "Rock063" (mossy, aged cliff rock) - https://ambientcg.com/a/Rock063
- Direct download used: https://ambientcg.com/get?file=Rock063_1K-JPG.zip
- Maps: diffuse.jpg, normal.png, roughness.jpg, ao.jpg
- Resolution: 1K (1024x512 - source asset is non-square)
- License: CC0

### stone-ruin
- Source: ambientCG "Bricks094" (old, dirty, medieval-style stone/brick wall) - https://ambientcg.com/a/Bricks094
- Direct download used: https://ambientcg.com/get?file=Bricks094_1K-JPG.zip
- Maps: diffuse.jpg, normal.png, roughness.jpg, ao.jpg
- Resolution: 1K (1024x512 - source asset is non-square)
- License: CC0

## Directory Structure

```
public/textures/
  bark-01/
    diffuse.jpg
    normal.png
    roughness.jpg
    ao.jpg
  bark-02/
    diffuse.jpg
    normal.png
    roughness.jpg
    ao.jpg
  foliage/
    diffuse.jpg
    normal.png
    roughness.jpg
    ao.jpg
  mud/
    diffuse.jpg
    normal.png
    roughness.jpg
    ao.jpg
  rock/
    diffuse.jpg
    normal.png
    roughness.jpg
    ao.jpg
  stone-ruin/
    diffuse.jpg
    normal.png
    roughness.jpg
    ao.jpg
```

Note: `normal.png` (not `.jpg`) - normal maps are kept lossless since JPG
compression artifacts on a normal map cause visible lighting glitches.
`src/core/textures.js` requests exactly these filenames/extensions per set.

## Integration Notes

- Textures multiply WITH vertex colours (`vertexColors = true` + `material.map`),
  not over them, to preserve the game's art direction.
- `applyTextures(material, textures, strength)` in `src/core/textures.js`
  desaturates the diffuse map toward luminance-only as `strength` drops below
  1, so the vertex-colour palette can dominate hue while the real photo's
  surface grain/detail still comes through. Real CC0 scans read as muddy/
  desaturated by default; this is the lever to pull if any material drags
  the game's saturated "vibrant Amazonian" look toward dull realism. Current
  per-material values live in `src/world/terrain.js` and `src/world/vegetation.js`
  (defaults 0.5-0.65).
- Loading is async and non-blocking (game boots while textures load).
- If a texture fails to load, the material falls back to vertex colour.
- All four maps use `THREE.RepeatWrapping` (added when integrating these
  assets) because world geometry drives UVs directly from world-space
  coordinates and routinely exceeds the 0-1 range - without repeat wrapping
  the sampler clamps at the texture edge and reads as stretched/smeared.
- UV tiling is varied per-vertex ("texture bombing") to break up obvious repetition.

## Re-sourcing / replacing a set later

To swap any set for a different CC0 asset:
1. Search https://ambientcg.com/list?q=<material> or https://polyhaven.com/textures
2. Download the 1K JPG version (zip includes Color/NormalGL/Roughness/AmbientOcclusion)
3. Rename to diffuse.jpg / normal.png (re-encode as PNG) / roughness.jpg / ao.jpg
4. Check `du -sh public/textures/` stays under the 25 MB budget
5. Update the entry above with the real asset ID and URL you used
