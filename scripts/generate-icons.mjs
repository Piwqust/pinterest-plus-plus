import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

/**
 * The mark is a masonry rhythm: one full-height column beside a split column.
 * It is the extension's actual subject — a grid whose tiles you resize — and it
 * stays a three-shape silhouette, which is all that survives 16 pixels.
 *
 * Geometry is authored on a 16-unit grid so every edge lands on a whole pixel
 * at 16px and scales exactly (x2, x3, x8) to the larger sizes.
 */
const GRID = 16;
const CORNER = 4;
/** One unit. Enough to feel soft, not so much that a tile reads as a capsule. */
const TILE_CORNER = 1;
const TILES = [
  { x: 3, y: 3, width: 4, height: 6 },
  { x: 3, y: 10, width: 4, height: 3 },
  { x: 9, y: 3, width: 4, height: 3 },
  { x: 9, y: 7, width: 4, height: 6 },
];

// A berry crimson of the extension's own, deliberately not Pinterest's brand
// red: the extension is unaffiliated and must not read as a first-party mark.
const BACKGROUND_LIGHT = '#E31B47';
const BACKGROUND_MID = '#C4102F';
const BACKGROUND_DEEP = '#8E0B2E';
const TILE_LIGHT = '#FFFFFF';
const TILE_WARM = '#FFF1EC';

const sizes = [16, 32, 48, 128];
/** Below this, a gradient spans too few pixels to read as anything but noise. */
const DETAIL_THRESHOLD = 48;

function tilePath(tile, scale, offsetY = 0) {
  const round = (value) => Number((value * scale).toFixed(2));
  return `<rect x="${round(tile.x)}" y="${round(tile.y) + offsetY}" width="${round(tile.width)}" ` +
    `height="${round(tile.height)}" rx="${round(TILE_CORNER)}"`;
}

function buildSvg(size) {
  const scale = size / GRID;
  const detailed = size >= DETAIL_THRESHOLD;
  const corner = Number((CORNER * scale).toFixed(2));
  const depth = Math.max(1, Math.round(size / 64));

  if (!detailed) {
    // Flat and maximally contrasty: at these sizes only luminance survives.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${corner}" fill="${BACKGROUND_MID}"/>
  ${TILES.map((tile) => `${tilePath(tile, scale)} fill="${TILE_LIGHT}"/>`).join('\n  ')}
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${BACKGROUND_LIGHT}"/>
      <stop offset="0.55" stop-color="${BACKGROUND_MID}"/>
      <stop offset="1" stop-color="${BACKGROUND_DEEP}"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.26" cy="0.12" r="0.9">
      <stop offset="0" stop-color="#FF6E86" stop-opacity="0.55"/>
      <stop offset="0.45" stop-color="#FF4A6A" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.98" r="0.85">
      <stop offset="0" stop-color="#4A0018" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#4A0018" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="${TILE_LIGHT}"/>
      <stop offset="1" stop-color="${TILE_WARM}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${corner}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" rx="${corner}" fill="url(#vignette)"/>
  <rect width="${size}" height="${size}" rx="${corner}" fill="url(#sheen)"/>
  ${TILES.map((tile) => `${tilePath(tile, scale, depth * 1.5)} fill="#4A0018" fill-opacity="0.30"/>`).join('\n  ')}
  ${TILES.map((tile) => `${tilePath(tile, scale)} fill="url(#tile)"/>`).join('\n  ')}
  <rect x="${depth / 2}" y="${depth / 2}" width="${size - depth}" height="${size - depth}"
    rx="${corner - depth / 2}" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="${depth}"/>
</svg>`;
}

await mkdir('public/icon', { recursive: true });
await Promise.all(sizes.map(async (size) => {
  const svg = buildSvg(size);
  // Rendering each size from its own SVG keeps edges crisp instead of
  // resampling one large raster down through the small sizes.
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(`public/icon/${size}.png`);
}));
// Kept beside the generator, not in public/, so it is never shipped as a
// stray asset inside the extension bundle.
await writeFile('scripts/icon-source.svg', `${buildSvg(128)}\n`);
