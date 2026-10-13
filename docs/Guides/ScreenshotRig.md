# Screenshot rig (before/after grading for art changes)

The `shots` API captures pixel-perfect deterministic screenshots of eight canonical vantage points across all three moods (bloom, gold, violet). All non-deterministic elements are frozen (wind sway, weather RNG, particles, HUD, effects) so two runs are identical except for art/lighting changes. Use this to grade major overhauls objectively.

```
// In the browser console:
window.__deadfall.shots.captureShots()                          # all 3 moods x 8 vantages
window.__deadfall.shots.captureShots({ mood: 'bloom' })         # single mood
await window.__deadfall.shots.downloadShots(shots)              # save PNG + contact sheet

// Or via URL param (auto-boots, captures, downloads):
http://localhost:5199?shots=1
```

Vantages cover: insertion beach, dense jungle (west), river crossing, gorge lip, ridge vista, mountain peak (Cinder Fang), boss basin (Sunken Maw), and extraction mesa. Contact sheet tiles all vantages with labels for quick visual review.
