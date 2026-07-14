# Texture Credits & License Information

**All textures in this directory are CC0 Public Domain.** No attribution required. Safe for commercial use, including Steam.

## Status

**Current textures (as of 2026-07-14):** Placeholder test assets validating the loading pipeline.
**Ready for:** Real CC0 asset substitution - just drop in replacements and game loads them.

---

## Recommended Sources (Both CC0, Both Tested)

### PRIMARY: ambientCG.com (RECOMMENDED)
- **License:** CC0 (no attribution required, commercial use allowed)
- **Quality:** Professional grade
- **Download speed:** Fast CDN
- **1K Resolution:** ~6-10 MB per texture (well under 25 MB budget for 6 sets)
- **Search:** https://ambientcg.com/list?q=bark (replace "bark" with material type)

**Direct search URLs:**
- Bark: https://ambientcg.com/list?q=bark
- Rock/Stone: https://ambientcg.com/list?q=rock
- Ground/Mud: https://ambientcg.com/list?q=ground
- Weathered: https://ambientcg.com/list?q=weathered

### SECONDARY: Poly Haven (polyhaven.com)

Poly Haven offers high-quality, freely usable 3D assets under the CC0 license. Attribution is appreciated but not required.

### bark-01
- Source: Poly Haven Bark_001 (https://polyhaven.com/a/bark_001)
- Maps: diffuse.jpg, normal.jpg, roughness.jpg, ao.jpg
- Resolution: 2K
- License: CC0

### bark-02
- Source: Poly Haven Ground_008 or alternative bark texture for contrast
- Maps: diffuse.jpg, normal.jpg, roughness.jpg
- Resolution: 2K
- License: CC0

### foliage
- Source: Poly Haven Leaves_001 or fabric/organic equivalent
- Maps: diffuse.jpg, normal.jpg, roughness.jpg
- Resolution: 2K
- License: CC0

### mud
- Source: Poly Haven Ground_001 or soil/mud variant
- Maps: diffuse.jpg, normal.jpg, roughness.jpg, ao.jpg
- Resolution: 2K
- License: CC0
- Note: Pick a texture with organic variation, not perfectly uniform

### rock
- Source: Poly Haven Rock_001 or stone/granite variant
- Maps: diffuse.jpg, normal.jpg, roughness.jpg, ao.jpg
- Resolution: 2K
- License: CC0

### stone-ruin
- Source: ambientCG weathered stone or Poly Haven Stone_Wall equivalent
- Maps: diffuse.jpg, normal.jpg, roughness.jpg
- Resolution: 2K
- License: CC0
- Note: Pick one with moss/lichen/age for "ruin" feel

## ambientCG (ambientcg.com)

ambientCG (successor to cc0textures.com) offers another excellent library of CC0 materials. Same license as above.

### Alternative/Backup sources
If Poly Haven textures are not available, equivalents can be sourced from:
- ambientCG: ambientcg.com (search for "bark", "soil", "rock", "stone", "weathered")
- Same CC0 license applies

## Directory Structure

```
public/textures/
  bark-01/
    diffuse.jpg
    normal.jpg
    roughness.jpg
    ao.jpg
  bark-02/
    diffuse.jpg
    normal.jpg
    roughness.jpg
  foliage/
    diffuse.jpg
    normal.jpg
    roughness.jpg
  mud/
    diffuse.jpg
    normal.jpg
    roughness.jpg
    ao.jpg
  rock/
    diffuse.jpg
    normal.jpg
    roughness.jpg
    ao.jpg
  stone-ruin/
    diffuse.jpg
    normal.jpg
    roughness.jpg
```

## Downloading Textures

To download textures:

1. Visit Poly Haven (polyhaven.com/textures)
2. Search for the texture names above
3. Download the 2K PBR versions (zip file includes all maps)
4. Extract into the corresponding directory under `public/textures/`

All maps should be named exactly as shown above (lowercase).

## Integration Notes

- Textures blend WITH vertex colours, not over them (preserves game art direction)
- Loading is async and non-blocking (game boots while textures load)
- If a texture fails to load, the material falls back to vertex colour
- Triplanar mapping on terrain prevents stretching on slopes
- UV tiling is varied per-vertex to break up obvious repetition
