"""Generate a deterministic original door-station icon, without external assets."""

import struct
import zlib
from pathlib import Path


def icon_png() -> bytes:
    """Draw a simple station silhouette, lens, speaker and bell button."""
    rows = bytearray()
    for y in range(256):
        rows.append(0)
        for x in range(256):
            pixel = (0, 0, 0, 0)
            if 54 <= x <= 201 and 10 <= y <= 245:
                pixel = (31, 57, 76, 255)
            if (x - 128) ** 2 + (y - 67) ** 2 <= 30**2:
                pixel = (90, 204, 226, 255)
            if (x - 128) ** 2 + (y - 67) ** 2 <= 15**2:
                pixel = (15, 34, 47, 255)
            if 91 <= x <= 165 and any(abs(y - row) <= 2 for row in (115, 127, 139)):
                pixel = (212, 226, 231, 255)
            if (x - 128) ** 2 + (y - 192) ** 2 <= 22**2:
                pixel = (90, 204, 226, 255)
            rows.extend(pixel)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack("!I", len(data))
            + kind
            + data
            + struct.pack("!I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack("!2I5B", 256, 256, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows)))
        + chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    target = Path(__file__).resolve().parents[1] / "custom_components/hikvision_intercom/brand"
    target.mkdir(exist_ok=True)
    (target / "icon.png").write_bytes(icon_png())
