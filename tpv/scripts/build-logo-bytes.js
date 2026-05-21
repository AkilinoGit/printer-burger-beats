// Converts assets/logo2.ico into ESC/POS raster bytes ready to print between
// ticket copies. Output: services/logo-bytes.ts (a single Uint8Array constant).
//
// Run with: node scripts/build-logo-bytes.js
//
// The .ico file contains a PNG payload (256x256 RGBA). We:
//   1. Extract the inner PNG from the ICO container.
//   2. Decode it with pngjs.
//   3. Resize (nearest-neighbour) to TARGET_WIDTH px, keeping aspect ratio.
//      Width must be a multiple of 8 (raster format packs 8 px per byte).
//   4. Convert to monochrome with Floyd-Steinberg dithering.
//   5. Emit GS v 0 raster image bytes wrapped with center alignment + line feed.

const fs   = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const TARGET_WIDTH    = 256; // px — must be multiple of 8. 256 px ≈ full 58mm width
const IG_TARGET_WIDTH = 48;  // px — small inline icon next to the IG handle
const ICO_PATH        = path.join(__dirname, '..', 'assets', 'logo2.ico');
const IG_PNG_PATH     = path.join(__dirname, '..', 'assets', 'instalogo.png');
const OUT_PATH        = path.join(__dirname, '..', 'services', 'logo-bytes.ts');

// ---------------------------------------------------------------------------
// Extract PNG payload from .ico
// ---------------------------------------------------------------------------

function extractPngFromIco(icoBuf) {
  // ICO header: 6 bytes, then ICONDIRENTRY (16 bytes each). For each entry,
  // bytes 8..12 = image data size, bytes 12..16 = offset to image data.
  // PNG-encoded icons start with the PNG signature at that offset.
  const count = icoBuf.readUInt16LE(4);
  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16;
    const size   = icoBuf.readUInt32LE(entryOffset + 8);
    const offset = icoBuf.readUInt32LE(entryOffset + 12);
    const slice  = icoBuf.subarray(offset, offset + size);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (slice.length >= 8 &&
        slice[0] === 0x89 && slice[1] === 0x50 && slice[2] === 0x4E && slice[3] === 0x47) {
      return slice;
    }
  }
  throw new Error('No PNG payload found inside ICO file');
}

// ---------------------------------------------------------------------------
// Nearest-neighbour resize on RGBA buffer
// ---------------------------------------------------------------------------

function resizeRgba(src, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const srcIdx = (sy * srcW + sx) * 4;
      const dstIdx = (y * dstW + x) * 4;
      dst[dstIdx]     = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// RGBA → grayscale (with alpha compositing on white background)
// ---------------------------------------------------------------------------

function rgbaToGray(rgba, w, h) {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3] / 255;
    // Composite over white
    const rC = r * a + 255 * (1 - a);
    const gC = g * a + 255 * (1 - a);
    const bC = b * a + 255 * (1 - a);
    gray[i] = 0.299 * rC + 0.587 * gC + 0.114 * bC;
  }
  return gray;
}

// ---------------------------------------------------------------------------
// Floyd-Steinberg dithering → 1 bit per pixel (1 = black, 0 = white)
// ---------------------------------------------------------------------------

function dither(gray, w, h) {
  const buf = Float32Array.from(gray);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const old = buf[idx];
      const nw  = old < 128 ? 0 : 255;
      out[idx]  = nw === 0 ? 1 : 0; // ESC/POS raster: 1 bit = black dot
      const err = old - nw;
      if (x + 1 < w)              buf[idx + 1]         += err * 7 / 16;
      if (y + 1 < h && x > 0)     buf[idx + w - 1]     += err * 3 / 16;
      if (y + 1 < h)              buf[idx + w]         += err * 5 / 16;
      if (y + 1 < h && x + 1 < w) buf[idx + w + 1]     += err * 1 / 16;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pack 1-bit pixels into bytes (MSB first, 8 px per byte)
// ---------------------------------------------------------------------------

function packBits(pixels, w, h) {
  if (w % 8 !== 0) throw new Error('Width must be a multiple of 8');
  const bytesPerRow = w / 8;
  const out = Buffer.alloc(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let xByte = 0; xByte < bytesPerRow; xByte++) {
      let b = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        if (pixels[y * w + x]) b |= (0x80 >> bit);
      }
      out[y * bytesPerRow + xByte] = b;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wrap raster bytes with GS v 0 command
//   GS v 0 m xL xH yL yH d1..dk
//     m = 0 (normal density)
//     xL/xH = bytes per row (little endian)
//     yL/yH = number of rows (little endian)
// ---------------------------------------------------------------------------

function buildEscPosRaster(packed, w, h) {
  const bytesPerRow = w / 8;
  const header = Buffer.from([
    0x1d, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
  ]);
  return Buffer.concat([header, packed]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function processPng(pngData, srcW, srcH, dstW) {
  // Round dstW down to multiple of 8 (raster format constraint).
  const w = dstW - (dstW % 8);
  const h = Math.round((srcH * w) / srcW);
  const resized = resizeRgba(pngData, srcW, srcH, w, h);
  const gray    = rgbaToGray(resized, w, h);
  const bits    = dither(gray, w, h);
  const packed  = packBits(bits, w, h);
  const raster  = buildEscPosRaster(packed, w, h);
  return { w, h, raster };
}

function formatBytes(raster) {
  const lines = [];
  for (let i = 0; i < raster.length; i += 16) {
    const chunk = Array.from(raster.subarray(i, i + 16))
      .map(b => '0x' + b.toString(16).padStart(2, '0'))
      .join(', ');
    lines.push('  ' + chunk + ',');
  }
  return lines.join('\n');
}

// Main logo from .ico
const ico    = fs.readFileSync(ICO_PATH);
const mainPng = PNG.sync.read(extractPngFromIco(ico));
const main    = processPng(mainPng.data, mainPng.width, mainPng.height, TARGET_WIDTH);

// Instagram icon from .png
const igPng    = PNG.sync.read(fs.readFileSync(IG_PNG_PATH));
const igIconW  = IG_TARGET_WIDTH - (IG_TARGET_WIDTH % 8);
const igIconH  = Math.round((igPng.height * igIconW) / igPng.width);
const igResized = resizeRgba(igPng.data, igPng.width, igPng.height, igIconW, igIconH);
const igGray    = rgbaToGray(igResized, igIconW, igIconH);
const igBits    = dither(igGray, igIconW, igIconH);  // 1 = black

// Compose a combined raster: [icon] [gap] [text "@burguer.beats"]
// Total width must be multiple of 8 and <= 384 (typical 58mm head).
// Use a 8x16 embedded bitmap font for the 10 unique characters needed.
const FONT_8x16 = (() => {
  // Each glyph is 16 rows of 8 bits (MSB = leftmost pixel).
  // Compact, hand-drawn lowercase + symbols for "@burguer.beats".
  const g = {};
  // '@' — 8x16
  g['@'] = [
    0b00000000,
    0b00111100,
    0b01000010,
    0b10011001,
    0b10100101,
    0b10100101,
    0b10100101,
    0b10100101,
    0b10100110,
    0b10011010,
    0b01000000,
    0b00111100,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 'b'
  g['b'] = [
    0b00000000,
    0b01000000,
    0b01000000,
    0b01000000,
    0b01000000,
    0b01111100,
    0b01100010,
    0b01000010,
    0b01000010,
    0b01000010,
    0b01100010,
    0b01011100,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 'u'
  g['u'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b01000010,
    0b01000010,
    0b01000010,
    0b01000010,
    0b01000010,
    0b01000110,
    0b00111010,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 'r'
  g['r'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b01011100,
    0b01100010,
    0b01000000,
    0b01000000,
    0b01000000,
    0b01000000,
    0b01000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 'g' (with descender)
  g['g'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00111110,
    0b01000010,
    0b01000010,
    0b01000010,
    0b00111110,
    0b00000010,
    0b00000010,
    0b00111100,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 'e'
  g['e'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00111100,
    0b01000010,
    0b01111110,
    0b01000000,
    0b01000000,
    0b01000010,
    0b00111100,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // '.'
  g['.'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00011000,
    0b00011000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 'a'
  g['a'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00111100,
    0b00000010,
    0b00111110,
    0b01000010,
    0b01000010,
    0b01000110,
    0b00111010,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 't'
  g['t'] = [
    0b00000000,
    0b00010000,
    0b00010000,
    0b00010000,
    0b01111100,
    0b00010000,
    0b00010000,
    0b00010000,
    0b00010000,
    0b00010000,
    0b00010010,
    0b00001100,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 's'
  g['s'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00111110,
    0b01000000,
    0b01000000,
    0b00111100,
    0b00000010,
    0b00000010,
    0b01111100,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  return g;
})();

const FONT_W = 8;
const FONT_H = 16;

function renderTextBits(text) {
  // Render at 2x scale so it visually matches the 48px icon better.
  const SCALE = 2;
  const w = text.length * FONT_W * SCALE;
  const h = FONT_H * SCALE;
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT_8x16[text[i]];
    if (!glyph) continue;
    for (let row = 0; row < FONT_H; row++) {
      const byte = glyph[row];
      for (let col = 0; col < FONT_W; col++) {
        if (byte & (0x80 >> col)) {
          // Fill a SCALE×SCALE block.
          for (let dy = 0; dy < SCALE; dy++) {
            for (let dx = 0; dx < SCALE; dx++) {
              const x = (i * FONT_W + col) * SCALE + dx;
              const y = row * SCALE + dy;
              bits[y * w + x] = 1;
            }
          }
        }
      }
    }
  }
  return { bits, w, h };
}

const HANDLE = '@burguer.beats';
const text = renderTextBits(HANDLE);

// Compose icon + gap + text into one raster row.
const GAP = 8; // px between icon and text
const composedH = Math.max(igIconH, text.h);
let composedW = igIconW + GAP + text.w;
composedW = composedW + ((8 - (composedW % 8)) % 8); // round up to multiple of 8

const composed = new Uint8Array(composedW * composedH);
// Paste icon (vertically centered).
const iconYOffset = Math.floor((composedH - igIconH) / 2);
for (let y = 0; y < igIconH; y++) {
  for (let x = 0; x < igIconW; x++) {
    if (igBits[y * igIconW + x]) {
      composed[(y + iconYOffset) * composedW + x] = 1;
    }
  }
}
// Paste text (vertically centered).
const textYOffset = Math.floor((composedH - text.h) / 2);
const textXOffset = igIconW + GAP;
for (let y = 0; y < text.h; y++) {
  for (let x = 0; x < text.w; x++) {
    if (text.bits[y * text.w + x]) {
      composed[(y + textYOffset) * composedW + (x + textXOffset)] = 1;
    }
  }
}

const igPacked = packBits(composed, composedW, composedH);
const ig = {
  w: composedW,
  h: composedH,
  raster: buildEscPosRaster(igPacked, composedW, composedH),
};

const ts = `// AUTO-GENERATED by scripts/build-logo-bytes.js — do not edit by hand.
// Sources:
//   assets/logo2.ico      → ${main.w}x${main.h} 1-bpp raster
//   assets/instalogo.png  → ${ig.w}x${ig.h} 1-bpp raster
// Regenerate with: node scripts/build-logo-bytes.js

export const LOGO_WIDTH  = ${main.w};
export const LOGO_HEIGHT = ${main.h};

/** ESC/POS GS v 0 raster image of the main logo. Header included. */
export const LOGO_RASTER_BYTES: Uint8Array = new Uint8Array([
${formatBytes(main.raster)}
]);

export const IG_LOGO_WIDTH  = ${ig.w};
export const IG_LOGO_HEIGHT = ${ig.h};

/** ESC/POS GS v 0 raster image of the Instagram icon. Header included. */
export const IG_LOGO_RASTER_BYTES: Uint8Array = new Uint8Array([
${formatBytes(ig.raster)}
]);
`;

fs.writeFileSync(OUT_PATH, ts, 'utf8');
console.log(`Wrote ${OUT_PATH}`);
console.log(`Main logo: ${main.w}x${main.h}, ${main.raster.length} bytes`);
console.log(`IG logo:   ${ig.w}x${ig.h}, ${ig.raster.length} bytes`);
