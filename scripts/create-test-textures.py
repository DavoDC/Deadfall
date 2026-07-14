#!/usr/bin/env python3
"""
Create simple test textures for Deadfall material system verification.
These are minimal placeholder PNG files to test the texture loading pipeline.
"""

from pathlib import Path
import struct

def create_minimal_png(filepath, width=4, height=4, color=(128, 128, 128)):
    """Create a minimal PNG file with solid color."""
    filepath = Path(filepath)
    filepath.parent.mkdir(parents=True, exist_ok=True)

    r, g, b = color

    # PNG file signature
    png_sig = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk (image header: 4x4, 8-bit RGB)
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr_crc = crc32(b'IHDR' + ihdr_data)
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)

    # IDAT chunk (image data - minimal scanlines)
    idat_data = b''
    for y in range(height):
        idat_data += b'\x00'  # filter type: none
        for x in range(width):
            idat_data += bytes([r, g, b])

    # Minimal zlib compression
    import zlib
    compressed = zlib.compress(idat_data, 9)
    idat_crc = crc32(b'IDAT' + compressed)
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)

    # IEND chunk (image end)
    iend_crc = crc32(b'IEND')
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)

    # Write PNG
    with open(filepath, 'wb') as f:
        f.write(png_sig + ihdr + idat + iend)

    print(f"Created {filepath} ({filepath.stat().st_size} bytes)")


def crc32(data):
    """Simple CRC32 calculation for PNG chunks."""
    import zlib
    return zlib.crc32(data) & 0xffffffff


def main():
    textures_dir = Path(__file__).parent.parent / 'public' / 'textures'

    # Create test texture sets with simple colors
    sets = [
        ('bark-01', (139, 90, 43)),      # brown
        ('bark-02', (150, 110, 80)),     # lighter brown
        ('foliage', (100, 150, 80)),     # green
        ('mud', (102, 85, 68)),          # muddy
        ('rock', (140, 140, 140)),       # gray
        ('stone-ruin', (130, 125, 115)), # stone
    ]

    for set_name, color in sets:
        set_dir = textures_dir / set_name
        print(f"Creating test texture set: {set_name} with color {color}")

        # Create all maps (diffuse, normal, roughness, ao)
        create_minimal_png(set_dir / 'diffuse.png', color=color)
        create_minimal_png(set_dir / 'normal.png', color=(128, 128, 255))    # normal map blue
        create_minimal_png(set_dir / 'roughness.png', color=(200, 200, 200))  # grayscale
        create_minimal_png(set_dir / 'ao.png', color=(150, 150, 150))         # grayscale

    print()
    print("Test textures created! These are minimal placeholders.")
    print("The actual CC0 textures can be downloaded from Poly Haven.")

if __name__ == '__main__':
    main()
