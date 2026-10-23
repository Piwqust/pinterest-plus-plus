import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

/**
 * The mark is a graphite keyboard key whose legend, "++", is lit white: the
 * extension as a shortcut, and the "Plus Plus" of its name. Monochrome on
 * purpose, in the manner of Raycast's keys: no brand colour to clash with the
 * pictures the extension sits next to, and nothing near Pinterest's red.
 *
 * 48 and 128 come from the rendered key (`store/brand/keycap-master.png`,
 * drawn in orvey and cut out of its backdrop). At 16 and 32 a render's legend
 * shrinks to two specks, so those sizes are drawn on the pixel grid instead:
 * the same key, flat, with strokes of whole pixels.
 */
const MASTER = 'store/brand/keycap-master.png';
/**
 * Chrome Web Store's 128px icon is a 96px mark with 16px of transparent
 * padding, so it sits level with the other icons on the listing.
 */
const RASTER = { 48: 48, 128: 96 };
const KEY = { base: '#18181B', face: '#343439', legend: '#FFFFFF' };

/** One plus is 5 units of a 16-unit grid; two sit side by side, 2 units apart. */
function toolbarSvg(px) {
  const unit = px / 16;
  const stroke = px < 32 ? 1 : 2;
  const radius = px * 0.24;
  const inset = px * (px < 32 ? 0.07 : 0.09);
  const size = 5 * unit;
  const pluses = [2, 9].map((column) => {
    const x = column * unit;
    const y = 5 * unit;
    const mid = size / 2;
    return `<rect x="${x}" y="${y + mid - stroke / 2}" width="${size}" height="${stroke}" fill="${KEY.legend}"/>` +
      `<rect x="${x + mid - stroke / 2}" y="${y}" width="${stroke}" height="${size}" fill="${KEY.legend}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
  <rect width="${px}" height="${px}" rx="${radius}" fill="${KEY.base}"/>
  <rect x="${inset}" y="${inset * 0.8}" width="${px - inset * 2}" height="${px - inset * 2.15}" rx="${radius * 0.7}" fill="${KEY.face}"/>
  ${pluses}
</svg>`;
}

await mkdir('public/icon', { recursive: true });
for (const [px, art] of Object.entries(RASTER)) {
  const size = Number(px);
  const mark = await sharp(MASTER).resize(art, art, { kernel: 'lanczos3' }).png().toBuffer();
  const pad = (size - art) / 2;
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: pad, top: pad }])
    .png({ compressionLevel: 9 })
    .toFile(`public/icon/${size}.png`);
}
for (const px of [16, 32]) {
  await sharp(Buffer.from(toolbarSvg(px))).png({ compressionLevel: 9 }).toFile(`public/icon/${px}.png`);
}
