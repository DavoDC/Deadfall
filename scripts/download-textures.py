#!/usr/bin/env python3
"""
Download CC0 PBR textures from Poly Haven for Deadfall.
Saves to public/textures/

This script requires an internet connection and Python 3.
Texture files are PNG format at 2K resolution from Poly Haven (polyhaven.com).

Run: python scripts/download-textures.py
"""

import os
from pathlib import Path
from urllib.request import urlopen

# Map of texture sets to download
# Format: (local_dir, poly_haven_slug, maps_to_copy)
TEXTURE_SETS = [
    ('bark-01', 'bark_001', ['diffuse', 'normal', 'roughness', 'ao']),
    ('bark-02', 'bark_002', ['diffuse', 'normal', 'roughness']),
    ('foliage', 'leaves_001', ['diffuse', 'normal', 'roughness']),
    ('mud', 'ground_001', ['diffuse', 'normal', 'roughness', 'ao']),
    ('rock', 'rock_001', ['diffuse', 'normal', 'roughness', 'ao']),
    ('stone-ruin', 'stone_wall_001', ['diffuse', 'normal', 'roughness']),
]

def download_poly_haven_texture(slug, local_dir, maps_to_copy):
    """Download a texture from Poly Haven and extract needed maps."""
    print(f"Downloading {slug}...")

    # Create target directory
    local_dir.mkdir(parents=True, exist_ok=True)

    # Poly Haven CDN URL pattern: 2K resolution
    resolution = '2k'

    for map_name in maps_to_copy:
        # Construct URL for this map
        url = f'https://cdn.polyhaven.com/asset_files/textures/{slug}/{resolution}/{slug}_{map_name}.png'

        try:
            print(f"  Downloading {map_name}...", end=' ', flush=True)
            with urlopen(url, timeout=30) as response:
                data = response.read()

            output_file = local_dir / f'{map_name}.png'
            with open(output_file, 'wb') as f:
                f.write(data)

            size_mb = len(data) / 1024 / 1024
            print(f"OK ({size_mb:.1f} MB)")
        except Exception as e:
            print(f"FAILED: {e}")
            return False

    return True

def main():
    script_dir = Path(__file__).parent
    deadfall_root = script_dir.parent
    textures_dir = deadfall_root / 'public' / 'textures'

    textures_dir.mkdir(parents=True, exist_ok=True)
    print(f"Downloading textures to {textures_dir}")
    print()

    success_count = 0
    for local_name, poly_haven_slug, maps in TEXTURE_SETS:
        target_dir = textures_dir / local_name
        success = download_poly_haven_texture(poly_haven_slug, target_dir, maps)
        if success:
            print(f"  => {local_name} ready")
            success_count += 1
        else:
            print(f"  => {local_name} FAILED - see above")
        print()

    print(f"Downloaded {success_count}/{len(TEXTURE_SETS)} texture sets")
    print()
    if success_count < len(TEXTURE_SETS):
        print("Some downloads failed. If you have network issues, you can:")
        print("1. Visit https://polyhaven.com/textures in your browser")
        print("2. Search for each texture name (e.g., 'bark_001')")
        print("3. Download the 2K PBR zip")
        print("4. Extract to public/textures/<local-name>/")
        print()
        print("See public/textures/CREDITS.md for details.")

if __name__ == '__main__':
    main()
