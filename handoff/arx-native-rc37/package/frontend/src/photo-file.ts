/** Bound local raster decoding before allocating pixels. No URL or device upload. */
export const PHOTO_FILE_BYTES = 5 * 1024 * 1024;
export const PHOTO_PIXELS = 16_000_000;
export function photoBounds(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > PHOTO_PIXELS
  )
    throw Error("photo_file_dimensions");
  return { width, height };
}
/** Header dimensions are a resource guard; the browser must still decode the entire image. */
export function photoHeader(bytes: Uint8Array, declared = "") {
  if (!bytes.length || bytes.length > PHOTO_FILE_BYTES) throw Error("photo_file_size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) => String.fromCharCode(...bytes.slice(at, at + length));
  const done = (mime: string, width: number, height: number) => {
    if (declared && declared !== mime) throw Error("photo_file_type");
    return { mime, ...photoBounds(width, height) };
  };
  if (
    bytes.length >= 33 &&
    bytes.slice(0, 8).every((v, i) => v === [137, 80, 78, 71, 13, 10, 26, 10][i]) &&
    text(12, 4) === "IHDR" &&
    view.getUint32(8) === 13
  )
    return done("image/png", view.getUint32(16), view.getUint32(20));
  if (bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > bytes.length) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 8
      )
        return done("image/jpeg", view.getUint16(at + 5), view.getUint16(at + 3));
      at += length;
    }
  }
  if (
    bytes.length >= 20 &&
    text(0, 4) === "RIFF" &&
    text(8, 4) === "WEBP" &&
    view.getUint32(4, true) + 8 === bytes.length
  ) {
    const u24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    let at = 12;
    let canvas: { width: number; height: number } | undefined;
    let raster: { width: number; height: number } | undefined;
    while (at + 8 <= bytes.length) {
      const kind = text(at, 4),
        length = view.getUint32(at + 4, true),
        body = at + 8;
      if (body + length > bytes.length) throw Error("photo_file_type");
      if (kind === "ANIM" || kind === "ANMF") throw Error("photo_file_type");
      if (kind === "VP8X" && length === 10) {
        if (bytes[body] & 2) throw Error("photo_file_type");
        canvas = photoBounds(1 + u24(body + 4), 1 + u24(body + 7));
      }
      if (kind === "VP8L" && length >= 5 && bytes[body] === 47) {
        const bits = view.getUint32(body + 1, true);
        raster = photoBounds(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
      }
      if (kind === "VP8 " && length >= 10 && text(body + 3, 3) === "\x9d\x01\x2a")
        raster = photoBounds(
          view.getUint16(body + 6, true) & 0x3fff,
          view.getUint16(body + 8, true) & 0x3fff,
        );
      at = body + length + (length % 2);
    }
    if (
      at === bytes.length &&
      raster &&
      (!canvas || (canvas.width === raster.width && canvas.height === raster.height))
    )
      return done("image/webp", raster.width, raster.height);
  }
  throw Error("photo_file_type");
}
