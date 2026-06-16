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
  // 'c'
  g['c'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00111100,
    0b01000010,
    0b01000000,
    0b01000000,
    0b01000000,
    0b01000010,
    0b00111100,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 'o'
  g['o'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00111100,
    0b01000010,
    0b01000010,
    0b01000010,
    0b01000010,
    0b01000010,
    0b00111100,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  // 'm'
  g['m'] = [
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
    0b11011100,
    0b11101110,
    0b10101010,
    0b10101010,
    0b10101010,
    0b10101010,
    0b10101010,
    0b00000000,
    0b00000000,
    0b00000000,
    0b00000000,
  ];
  return g;
})();

const FONT_W = 8;
const FONT_H = 16;

function renderTextBits(text, scale = 2) {
  // Render at `scale`x so the text visually matches the adjacent icon.
  const SCALE = scale;
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

// ---------------------------------------------------------------------------
// Envelope (email) icon — drawn programmatically, no asset needed.
// A rounded rectangle outline with the classic flap "V" from the top corners.
// ---------------------------------------------------------------------------

function drawEnvelopeBits(w, h) {
  const bits = new Uint8Array(w * h);
  const set = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) bits[y * w + x] = 1; };
  const thick = 4; // bold strokes to match the Instagram glyph weight
  // Outer rectangle border.
  for (let t = 0; t < thick; t++) {
    for (let x = 0; x < w; x++) { set(x, t); set(x, h - 1 - t); }
    for (let y = 0; y < h; y++) { set(t, y); set(w - 1 - t, y); }
  }
  // Flap: two diagonals from the top corners meeting at the vertical center, so
  // the flap's tip sits on the icon's horizontal mid-line.
  const midX = Math.floor(w / 2);
  const flapDepth = Math.floor(h / 2);
  for (let x = 0; x <= midX; x++) {
    const y = Math.round((x / midX) * flapDepth);
    for (let t = 0; t < thick; t++) { set(x, y + t); set(w - 1 - x, y + t); }
  }
  return bits;
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

// IG raster is packed further below, after both blocks are padded to a shared
// width so the email and Instagram icons line up at the same x.

// ---------------------------------------------------------------------------
// Email block. The address is rendered at 2x. At that size the full address is
// wider than the 58mm head (~384 px), so it wraps after the "@" onto two lines.
// The envelope icon spans both lines and is vertically centered, so its
// horizontal mid-line (the flap tip) lands exactly on the line break. Line 2
// starts flush with the start of the text on line 1:
//   line 1: [envelope] burguerbeats@
//   line 2:            burguerbeats.com
// Both lines are baked into a single raster so escpos.ts prints it in one shot.
// ---------------------------------------------------------------------------

const EMAIL_SCALE = 2;
const ENV_W = igIconW;                  // same width as the Instagram icon
const ENV_H = Math.round(igIconH * 0.8); // a touch shorter to keep envelope proportions
const envBits = drawEnvelopeBits(ENV_W, ENV_H);

const emailLine1 = renderTextBits('burguerbeats@', EMAIL_SCALE);
const emailLine2 = renderTextBits('burguerbeats.com', EMAIL_SCALE);

const textX = ENV_W + GAP;          // x where the address text begins (after icon)
const textH = emailLine1.h;
const LINE_GAP = 10; // px between the two wrapped lines
const emailH = textH + LINE_GAP + textH;

let emailW = Math.max(textX + emailLine1.w, textX + emailLine2.w);
emailW = emailW + ((8 - (emailW % 8)) % 8); // round up to multiple of 8

const emailComposed = new Uint8Array(emailW * emailH);
const blit = (target, targetW, bits, bw, bh, ox, oy) => {
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (bits[y * bw + x]) target[(y + oy) * targetW + (x + ox)] = 1;
    }
  }
};

// Envelope icon, vertically centered over the whole two-line block.
blit(emailComposed, emailW, envBits, ENV_W, ENV_H, 0, Math.floor((emailH - ENV_H) / 2));
// Line 1: "burguerbeats@".
blit(emailComposed, emailW, emailLine1.bits, emailLine1.w, emailLine1.h, textX, 0);
// Line 2: "burguerbeats.com", aligned with the start of line 1's text.
blit(emailComposed, emailW, emailLine2.bits, emailLine2.w, emailLine2.h, textX, textH + LINE_GAP);

// ---------------------------------------------------------------------------
// Pad both blocks to a common width (content kept at x=0) so that, once each is
// centered at print time, the envelope and Instagram icons land at the same x.
// ---------------------------------------------------------------------------

let sharedW = Math.max(composedW, emailW);
sharedW = sharedW + ((8 - (sharedW % 8)) % 8);

function padToWidth(bits, w, h, newW) {
  if (newW === w) return bits;
  const out = new Uint8Array(newW * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bits[y * w + x]) out[y * newW + x] = 1;
    }
  }
  return out;
}

const igPadded = padToWidth(composed, composedW, composedH, sharedW);
const igPacked = packBits(igPadded, sharedW, composedH);
const ig = {
  w: sharedW,
  h: composedH,
  raster: buildEscPosRaster(igPacked, sharedW, composedH),
};

const emailPadded = padToWidth(emailComposed, emailW, emailH, sharedW);
const emailPacked = packBits(emailPadded, sharedW, emailH);
const email = {
  w: sharedW,
  h: emailH,
  raster: buildEscPosRaster(emailPacked, sharedW, emailH),
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

export const EMAIL_LOGO_WIDTH  = ${email.w};
export const EMAIL_LOGO_HEIGHT = ${email.h};

/** ESC/POS GS v 0 raster image of the email icon + address. Header included. */
export const EMAIL_LOGO_RASTER_BYTES: Uint8Array = new Uint8Array([
${formatBytes(email.raster)}
]);
`;

fs.writeFileSync(OUT_PATH, ts, 'utf8');
console.log(`Wrote ${OUT_PATH}`);
console.log(`Main logo: ${main.w}x${main.h}, ${main.raster.length} bytes`);
console.log(`IG logo:   ${ig.w}x${ig.h}, ${ig.raster.length} bytes`);
console.log(`Email:     ${email.w}x${email.h}, ${email.raster.length} bytes`);
