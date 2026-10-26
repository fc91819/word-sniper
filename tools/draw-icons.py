#!/usr/bin/env python3
"""Draw the game's dark-and-green crosshair app icons using only Python stdlib."""

import math
import os
import struct
import zlib


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "icons")
BACKGROUND = (16, 23, 19, 255)
GREEN = (185, 237, 119, 255)
GREEN_DARK = (117, 156, 70, 255)


def blend(a, b, t):
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(4))


def draw_icon(size):
    pixels = bytearray(size * size * 4)
    center = (size - 1) / 2
    scale = size / 180
    outer = 62 * scale
    inner = 48 * scale
    line = max(2.1 * scale, 1.0)
    arm_inner = 26 * scale
    arm_outer = 78 * scale

    for y in range(size):
        for x in range(size):
            dx, dy = x - center, y - center
            distance = math.hypot(dx, dy)
            diamond_distance = abs(dx) + abs(dy)
            color = BACKGROUND
            if abs(diamond_distance - outer) <= line:
                color = GREEN_DARK
            if abs(distance - inner) <= line:
                color = GREEN
            on_arm = (abs(dx) <= line and arm_inner <= abs(dy) <= arm_outer) or (
                abs(dy) <= line and arm_inner <= abs(dx) <= arm_outer
            )
            if on_arm:
                color = GREEN
            if abs(dx) <= 5.5 * scale and abs(dy) <= 5.5 * scale:
                color = GREEN
            offset = (y * size + x) * 4
            pixels[offset:offset + 4] = bytes(color)
    return png_bytes(size, size, pixels)


def png_bytes(width, height, pixels):
    scanlines = b"".join(
        b"\x00" + pixels[row * width * 4:(row + 1) * width * 4]
        for row in range(height)
    )

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">2I5B", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(scanlines, 9)) + chunk(b"IEND", b"")


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    for size, filename in ((192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")):
        path = os.path.join(ICON_DIR, filename)
        with open(path, "wb") as icon_file:
            icon_file.write(draw_icon(size))
        print(f"{filename}: {size}x{size}")


if __name__ == "__main__":
    main()
