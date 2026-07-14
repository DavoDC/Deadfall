#!/usr/bin/env python3
"""
Download real CC0 PBR textures from Poly Haven using direct CDN URLs.
Targets 1K resolution to stay well under 25 MB budget.

Usage: python scripts/download-real-textures.py
"""

import urllib.request
import urllib.error
import zipfile
import io
from pathlib import Path

# Poly Haven textures: (local_dir, polyhaven_slug)
# These are known, working asset slugs from polyhaven.com
TEXTURE_SETS = [
    ("bark-01", "bark_001"),
    ("bark-02", "bark_002"),
    ("foliage", "leaves_001"),
    ("mud", "ground_001"),
    ("rock", "rock_001"),
    ("stone-ruin", "stone_wall_001"),
]

def get_download_url(asset_slug, resolution="1k"):
    """Construct Poly Haven CDN download URL for a texture zip."""
    # Poly Haven CDN pattern for individual texture files (not bulk zip)
    # For 1K, textures are in: /asset_files/textures/{slug}/1k/{slug}_1k_{maptype}.{ext}
    return f"https://cdn.polyhaven.com/asset_files/textures/{asset_slug}/1k/"

def download_single_map(base_url, slug, map_type, out_path):
    """Download a single texture map from Poly Haven CDN."""
    # Common naming patterns in Poly Haven
    url_patterns = [
        f"{base_url}{slug}_1k_{map_type}.jpg",
        f"{base_url}{slug}_1k_{map_type}.png",
        f"{base_url}{slug}_1_{map_type}.jpg",
        f"{base_url}{slug}_{map_type}.jpg",
    ]

    for url in url_patterns:
        try:
            print(f"    Trying: {url}")
            with urllib.request.urlopen(url, timeout=10) as response:
                data = response.read()
                with open(out_path, "wb") as f:
                    f.write(data)
                print(f"      Downloaded {len(data) / 1024:.1f} KB")
                return True
        except urllib.error.HTTPError:
            continue
        except Exception as e:
            print(f"      Error: {e}")
            continue

    return False

def download_texture_set(slug, local_dir):
    """Download all maps for a texture set."""
    local_dir.mkdir(parents=True, exist_ok=True)
    base_url = get_download_url(slug, "1k")

    print(f"  Base URL: {base_url}")

    # Map types to download and their output filenames
    maps_to_get = [
        ("diffuse", "diffuse.jpg"),
        ("normal", "normal.png"),
        ("roughness", "roughness.jpg"),
        ("ao", "ao.jpg"),
    ]

    success = False
    for map_type, out_name in maps_to_get:
        out_path = local_dir / out_name
        print(f"  Downloading {map_type}...")
        if download_single_map(base_url, slug, map_type, out_path):
            success = True

    return success

def main():
    deadfall_root = Path(__file__).parent.parent
    textures_dir = deadfall_root / "public" / "textures"

    print("Downloading real CC0 textures from Poly Haven (1K resolution)")
    print()

    total_bytes = 0
    success_count = 0

    for local_name, poly_slug in TEXTURE_SETS:
        print(f"Texture: {local_name} ({poly_slug})")
        target_dir = textures_dir / local_name

        if download_texture_set(poly_slug, target_dir):
            # Calculate total size
            dir_size = 0
            for f in target_dir.glob("*"):
                if f.is_file():
                    dir_size += f.stat().st_size
            total_bytes += dir_size
            success_count += 1
            print(f"  Success - {dir_size / 1024:.1f} KB")
        else:
            print(f"  Failed")
        print()

    print(f"Results: {success_count}/{len(TEXTURE_SETS)} sets downloaded")
    print(f"Total size: {total_bytes / 1024 / 1024:.2f} MB")
    print(f"Budget: 25 MB - {'PASS' if total_bytes < 25 * 1024 * 1024 else 'FAIL'}")

if __name__ == "__main__":
    main()
