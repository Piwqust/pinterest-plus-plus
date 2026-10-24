import { spawn } from 'node:child_process';
import { mkdir, readFile, copyFile, access, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

/**
 * Chrome Web Store screenshots and promo tiles, rendered from HTML scenes.
 *
 * The look is quiet and monochrome, like the mark: a near-black canvas, white
 * light falling across it in soft diagonal beams (the way Raycast lets its
 * stripes carry the brand), one short headline and one grey line, and the
 * product itself, large, in a framed window cropped by the bottom edge. One
 * feature per frame, nothing else competing for the eye.
 *
 * The controls are not redrawn: they wear the extension's real stylesheets
 * (`SHADOW_CSS` for the pin buttons and the corner, `COLLECTION_CSS` for the
 * collection panel), and its icons and colour swatches are read from source. The pins are
 * pictures generated for this listing (`store/scenes/media`), never other
 * people's pins, and no Pinterest logo or brand red appears.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scenesDir = join(root, 'store', 'scenes');
const assetsDir = join(root, 'store', 'assets');
const iconSrc = join(root, 'public', 'icon', '128.png');

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8v-4m0 0h4M5 4l3 3a7 7 0 1 1-1.4 7.2"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  smaller: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
  larger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0-4 4m4-4 4 4"/><path d="M6 13v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};

const src = await readFile(join(root, 'shared', 'ui-assets.ts'), 'utf8');
const shadowMatch = src.match(/export const SHADOW_CSS = `([\s\S]*?)`;/);
if (!shadowMatch) throw new Error('Could not read SHADOW_CSS');
const shadowCss = shadowMatch[1].replaceAll(':host', '.ppp-root');
const collectionSrc = await readFile(join(root, 'shared', 'collection-css.ts'), 'utf8');
const collectionMatch = collectionSrc.match(/export const COLLECTION_CSS = `([\s\S]*?)`;/);
if (!collectionMatch) throw new Error('Could not read COLLECTION_CSS');
const collectionCss = collectionMatch[1];
/** The extension's own icons, read from its source rather than redrawn. */
const UI_ICONS = Object.fromEntries([...src.matchAll(/^\s+(\w+): '(<svg[^']*)',?$/gm)].map(([, name, svg]) => [name, svg]));
for (const name of ['collect', 'collected', 'collection', 'scan', 'folder', 'plus', 'check', 'external']) {
  if (!UI_ICONS[name]) throw new Error(`Could not read the ${name} icon`);
}
const modelSrc = await readFile(join(root, 'shared', 'collection.ts'), 'utf8');
const swatchBlock = modelSrc.match(/export const HUE_SWATCH[^{]*\{([\s\S]*?)\};/)?.[1];
if (!swatchBlock) throw new Error('Could not read HUE_SWATCH');
const HUE_SWATCH = Object.fromEntries([...swatchBlock.matchAll(/(\w+): '([^']+)'/g)].map(([, hue, paint]) => [hue, paint]));
const panelSrc = await readFile(join(root, 'shared', 'collection-panel.ts'), 'utf8');
const shapeBlock = panelSrc.match(/const SHAPE_ICON[^{]*\{([\s\S]*?)\};/)?.[1];
if (!shapeBlock) throw new Error('Could not read SHAPE_ICON');
const SHAPE_ICON = Object.fromEntries([...shapeBlock.matchAll(/(\w+): '(<svg[^']*)'/g)].map(([, shape, svg]) => [shape, svg]));

/** A pin picture: file, footer title, and the width/height of the picture. */
const PINS = {
  living: ['01-living-room.jpg', 'Soft minimal living room', 2 / 3],
  vases: ['02-vases.jpg', 'Handmade ceramics', 3 / 4],
  granola: ['03-granola.jpg', 'Berry granola bowl', 4 / 5],
  coat: ['04-street-style.jpg', 'Autumn coat outfit', 2 / 3],
  greece: ['05-mediterranean.jpg', 'Summer in Greece', 3 / 4],
  plants: ['06-plants.jpg', 'Indoor jungle', 4 / 5],
  shapes: ['07-shapes.jpg', 'Soft 3D shapes', 1],
  nook: ['08-reading-nook.jpg', 'Reading corner', 3 / 4],
  kitchen: ['09-kitchen.jpg', 'Japandi kitchen', 2 / 3],
  flowers: ['10-wildflowers.jpg', 'Wildflower jar', 4 / 5],
  concrete: ['11-architecture.jpg', 'Concrete curves', 2 / 3],
  sketch: ['12-sketchbook.jpg', 'Watercolor botanicals', 4 / 3],
  sunset: ['13-sunset.jpg', 'Pastel sunset', 3 / 4],
  tart: ['14-lemon-tart.jpg', 'Lemon meringue tart', 1],
  cat: ['15-cat.jpg', 'Sunday nap', 4 / 5],
  bath: ['16-bathroom.jpg', 'Terrazzo bathroom', 2 / 3],
};

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=block" rel="stylesheet" />`;

const NOISE = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const sceneCss = `
  :root {
    --canvas: #09090b; --light: #ffffff; --mist: #d6dcff;
    --ink: #1d1b20; --muted: #6f6a75; --grey: #8e8e96; --line: rgba(255, 255, 255, .12);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    position: relative; overflow: hidden; color: #fff; background: var(--canvas);
    font-family: Inter, "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  }
  body::after {
    position: absolute; inset: 0; z-index: 50; content: ""; pointer-events: none;
    background-image: ${NOISE}; opacity: .04; mix-blend-mode: overlay;
  }
  .gridlines {
    position: absolute; inset: 0;
    background-image: linear-gradient(rgba(255, 255, 255, .05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, .05) 1px, transparent 1px);
    background-size: 56px 56px; background-position: center 0;
    -webkit-mask-image: radial-gradient(ellipse 60% 55% at 50% 30%, #000 0%, transparent 72%);
  }
  .glow { position: absolute; border-radius: 50%; filter: blur(90px); }
  /* White light through blinds: the key's glow, spread across the canvas. */
  .beams {
    position: absolute; left: -300px; right: -300px; top: -260px; height: 1100px; pointer-events: none;
    background: repeating-linear-gradient(118deg, transparent 0 120px, rgba(255, 255, 255, .11) 150px 210px, transparent 240px 330px);
    filter: blur(14px);
    -webkit-mask-image: radial-gradient(ellipse 46% 40% at 50% 34%, #000 0%, transparent 72%);
  }

  .head { position: absolute; left: 0; right: 0; z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
  .brand { display: inline-flex; align-items: center; gap: 8px; color: var(--grey); font-size: 14px; font-weight: 500; letter-spacing: -.005em; }
  .brand img { width: 28px; height: 28px; margin: -4px; }
  h1 {
    margin: 0; font-size: 54px; line-height: 1.04; font-weight: 600; letter-spacing: -.045em; text-wrap: balance;
    background: linear-gradient(180deg, #ffffff 30%, #b9b9c2); -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .sub { margin: 0; max-width: 640px; color: var(--grey); font-size: 19px; line-height: 1.5; font-weight: 400; letter-spacing: -.012em; text-wrap: balance; }

  .window {
    position: absolute; overflow: hidden; border-radius: 16px; color: var(--ink); background: #fff;
    box-shadow: 0 0 0 1px var(--line), 0 40px 120px -30px rgba(255, 255, 255, .1), 0 30px 80px rgba(0, 0, 0, .65);
  }
  .chrome { height: 42px; display: flex; align-items: center; gap: 14px; padding: 0 16px; background: #1b1b1e; border-bottom: 1px solid rgba(255, 255, 255, .06); }
  .lights { display: flex; gap: 7px; }
  .lights i { width: 11px; height: 11px; border-radius: 50%; background: #3b3b40; }
  .url {
    width: 320px; height: 26px; margin: 0 auto; transform: translateX(-34px); border-radius: 8px; background: #27272b;
    display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--grey); font-size: 12.5px; font-weight: 500;
  }
  .url svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; }
  .viewport { padding: 0 16px; }
  .site-head { height: 58px; display: flex; align-items: center; gap: 12px; }
  .search {
    flex: 1; height: 40px; border-radius: 999px; background: #efeef1; display: flex; align-items: center; gap: 9px; padding: 0 16px;
    color: #8b8691; font-size: 14px; font-weight: 500;
  }
  .search svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
  .me { width: 34px; height: 34px; border-radius: 50%; background: url(media/15-cat.jpg) center / cover; }
  .cols { display: flex; gap: 14px; align-items: flex-start; }
  .col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; }

  .pin { position: relative; }
  .media { position: relative; overflow: hidden; border-radius: 16px; background: #eee; }
  .media > img { display: block; width: 100%; aspect-ratio: var(--ratio); object-fit: cover; }
  .foot { display: flex; align-items: center; gap: 4px; padding: 7px 2px 0 4px; }
  .title { flex: 1; min-width: 0; overflow: hidden; color: var(--ink); font-size: 13px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
  .more { flex: none; width: 24px; height: 24px; display: grid; place-items: center; color: var(--ink); }
  .more svg { width: 16px; height: 16px; fill: currentColor; }
  .duration {
    position: absolute; left: 10px; top: 10px; padding: 4px 8px; border-radius: 999px; color: var(--ink); background: rgba(255, 255, 255, .9);
    font-size: 12px; font-weight: 600;
  }

  .hover { position: absolute; inset: 0; background: rgba(0, 0, 0, .3); }
  .board, .save, .visit, .share { position: absolute; display: flex; align-items: center; font-weight: 600; }
  .board { left: 12px; top: 14px; gap: 4px; font-size: 15px; color: #fff; }
  .board svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2.4; }
  .save { right: 12px; top: 10px; height: 38px; padding: 0 16px; border-radius: 999px; color: #fff; background: #1d1b20; font-size: 14px; }
  .visit { left: 12px; bottom: 12px; height: 34px; gap: 6px; padding: 0 12px; border-radius: 999px; color: var(--ink); background: #fff; font-size: 13px; }
  .visit svg, .share svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .share { right: 12px; bottom: 12px; width: 34px; height: 34px; justify-content: center; border-radius: 50%; color: var(--ink); background: #fff; }
  .panel { position: absolute; left: 12px; bottom: 12px; line-height: 0; }
  .panel.lifted { bottom: 54px; }

  .ppp-root { font-family: Inter, "Segoe UI", system-ui, sans-serif; font-weight: 600; }
  .ppp-root .ppp-toast { position: static; transform: none; opacity: 1; }
  .ppp-root .ppp-media-picker { position: static; box-shadow: 0 0 0 1px rgba(0, 0, 0, .04), 0 40px 80px -24px rgba(0, 0, 0, .55); }
  .ppp-root .ppp-grid-shell { position: static; opacity: 1; }
  .ppp-root .ppp-grid-shell { border-radius: 9px; box-shadow: 0 30px 60px -20px rgba(0, 0, 0, .45); }
  .cursor { position: absolute; z-index: 40; display: block; pointer-events: none; filter: drop-shadow(0 3px 5px rgba(0, 0, 0, .35)); }
  .cursor svg { display: block; width: 100% !important; height: 100% !important; }

  .label { margin: 0 0 12px; color: var(--grey); font-size: 14px; font-weight: 500; text-align: center; }
  .label svg { width: 18px; height: 18px; margin-left: 3px; vertical-align: -4px; fill: currentColor; }
  .card-frame { padding: 12px 12px 10px; border-radius: 20px; background: #fff; box-shadow: 0 0 0 1px var(--line), 0 40px 100px -30px rgba(0, 0, 0, .7); }

  /* A heading set beside the product instead of above it. */
  .head.side { right: auto; align-items: flex-start; text-align: left; gap: 18px; }
  .head.side h1 { font-size: 52px; }
  .head.side .sub { max-width: none; text-wrap: pretty; }
  .points { display: grid; gap: 12px; margin: 10px 0 0; padding: 0; list-style: none; color: #c9c9d1; font-size: 16px; font-weight: 500; letter-spacing: -.01em; }
  .points li { display: flex; align-items: center; gap: 11px; }
  .points svg { flex: none; width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: .85; }
  /* The panel sits in the page's own corner, inside the browser window. */
  .ppp-c-panel.scene-panel { position: absolute; top: 54px; right: 12px; bottom: auto; animation: none; z-index: 20; }
  .scene-panel .ppp-c-scroll { overflow: hidden; }
  .scene-panel .ppp-c-select { margin-left: auto; }
  .window .ppp-c-panel { color: #f4f4f6; }
`;

const CURSOR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 2.8v16.6l4.3-4.1 2.7 6.1 2.9-1.3-2.7-6h6z" fill="#1d1b20" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
/** Where the arrow's tip sits in the cursor's own box, as a share of its size. */
const CURSOR_TIP = { x: 5.5 / 24, y: 2.8 / 24 };

/**
 * A pointer resting on (x, y) of the element it is placed in. It lives inside
 * its target, so it lands on the control whatever the layout around it does.
 * Sizes are in the target's own pixels, which a zoomed parent scales.
 */
function cursorAt(x, y, size = 30) {
  const left = (x - size * CURSOR_TIP.x).toFixed(1);
  const top = (y - size * CURSOR_TIP.y).toFixed(1);
  return `<i class="cursor" style="left:${left}px;top:${top}px;width:${size}px;height:${size}px">${CURSOR}</i>`;
}

/**
 * Places a block on the canvas and zooms only what is inside it. CSS zoom on
 * a positioned element scales its own offsets too, which threw zoomed blocks
 * off the frame.
 */
function placed({ left, top, zoom = 1, z = 30, width }, inner) {
  const size = width ? `;width:${width}px` : '';
  return `<div style="position:absolute;left:${left}px;top:${top}px;z-index:${z}${size}"><div style="zoom:${zoom}">${inner}</div></div>`;
}

/** Glows of the brand colours, each a blurred disc: [left, top, size, colour, opacity]. */
function glows(list) {
  return list.map(([left, top, size, colour, opacity]) =>
    `<div class="glow" style="left:${left}px;top:${top}px;width:${size}px;height:${size * 0.62}px;background:${colour};opacity:${opacity}"></div>`).join('');
}

function backdrop(glowList) {
  return `<div class="gridlines"></div><div class="beams"></div>${glows(glowList)}`;
}

const ACTION_SIZE = { grid: 28, closeup: 40 };

/** The extension's Copy, Download and collect buttons; `pointing` puts the cursor on one of them. */
function actionsHtml(scope, { rowSize = 24, pointing = null, cursorSize = 24, collected = false } = {}) {
  const style = scope === 'row' ? ` style="--ppp-row-size:${rowSize}px"` : '';
  const size = ACTION_SIZE[scope] ?? rowSize;
  // Resting just inside the lower right of the button, so its icon stays in view.
  const pointer = (action) => (pointing === action ? cursorAt(size * 0.66, size * 0.7, cursorSize) : '');
  return `<span class="ppp-root"${style}><span class="ppp-pin-actions" data-scope="${scope}">
    <button class="ppp-action" type="button" aria-label="Copy media">${ICONS.copy}<span>Copy media</span>${pointer('copy')}</button>
    <button class="ppp-action" type="button" aria-label="Download media">${ICONS.download}<span>Download media</span>${pointer('download')}</button>
    <button class="ppp-action" type="button" data-action="collect" data-collected="${collected}" aria-label="Add to collection">${collected ? UI_ICONS.collected : UI_ICONS.collect}<span>Add to collection</span>${pointer('collect')}</button>
  </span></span>`;
}

/** Pinterest's own hover state, with the extension's panel in the corner it keeps free. */
function hoverLayer({ visit = true, pointing = null, collected = false, board = true } = {}) {
  return `<div class="hover">
    ${board ? `<span class="board">Inspiration ${ICONS.chevron}</span>` : ''}
    <span class="save">Save</span>
    ${visit ? `<span class="visit">${ICONS.arrow}Visit site</span>` : ''}
    <span class="share">${ICONS.share}</span>
    <span class="panel${visit ? ' lifted' : ''}">${actionsHtml('grid', { pointing, collected })}</span>
  </div>`;
}

function pin(key, { hovered = false, visit = true, row = false, duration = '', ratio = null, pointing = null, collected = false, board = true } = {}) {
  const [file, name, natural] = PINS[key];
  return `<article class="pin">
    <div class="media"><img src="media/${file}" alt="" style="--ratio:${ratio ?? natural}" />
      ${duration ? `<span class="duration">${duration}</span>` : ''}
      ${hovered ? hoverLayer({ visit, pointing, collected, board }) : ''}
    </div>
    <div class="foot"><span class="title">${name}</span>${row ? actionsHtml('row') : ''}<span class="more">${ICONS.dots}</span></div>
  </article>`;
}

function columns(cols) {
  return `<div class="cols">${cols.map((col) => `<div class="col">${col.join('')}</div>`).join('')}</div>`;
}

function windowChrome(url = 'pinterest.com') {
  return `<div class="chrome"><span class="lights"><i></i><i></i><i></i></span><span class="url">${ICONS.lock}${url}</span></div>`;
}

function browser({ left, top, width, height, zoom = 1, inner, overlay = '' }) {
  return `<div class="window" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px">
    ${windowChrome()}
    <div class="viewport" style="zoom:${zoom}">
      <div class="site-head"><span class="search">${ICONS.search}Search for ideas</span><span class="me"></span></div>
      ${inner}
    </div>
    ${overlay}
  </div>`;
}

function heading({ title, sub, top = 56 }) {
  return `<div class="head" style="top:${top}px">
    <span class="brand"><img src="../../public/icon/128.png" alt="" />Pinterest Plus Plus</span>
    <h1>${title}</h1>
    <p class="sub">${sub}</p>
  </div>`;
}

/** A heading beside the product: brand, headline, one line, and a few short points. */
function sideHeading({ title, sub, points = [], left, top, width }) {
  return `<div class="head side" style="left:${left}px;top:${top}px;width:${width}px">
    <span class="brand"><img src="../../public/icon/128.png" alt="" />Pinterest Plus Plus</span>
    <h1>${title}</h1>
    <p class="sub">${sub}</p>
    ${points.length ? `<ul class="points">${points.map(([icon, text]) => `<li>${icon}${text}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function toast(message, { left, top }) {
  return placed({ left, top, z: 35 }, `<div class="ppp-root"><div class="ppp-toast" data-visible="true">${message}</div></div>`);
}

const RANGE = { min: 160, max: 420 };

function gridPanel({ left, top, zoom, value, current, collected = 0 }) {
  // The thumb's centre on the 180px track, so the cursor can rest on it.
  const share = (current - RANGE.min) / (RANGE.max - RANGE.min);
  const thumbX = 8 + 6.5 + (180 - 13) * share;
  return placed({ left, top, zoom }, `<div class="ppp-root"><div class="ppp-grid-shell">
    <button class="ppp-c-launch" type="button" aria-label="Collection">${UI_ICONS.collection}<span class="ppp-c-launch-count" data-empty="${collected === 0}">${collected}</span></button>
    <section class="ppp-grid-panel" aria-label="Grid tile size" style="position:relative">
      <label class="ppp-range-row"><input class="ppp-range" type="range" min="${RANGE.min}" max="${RANGE.max}" step="4" value="${current}" aria-label="Tile width" /></label>
      <div class="ppp-grid-foot">
        <button class="ppp-step" type="button" aria-label="More columns">${ICONS.smaller}<span>More columns</span></button>
        <span class="ppp-grid-value">${value}</span>
        <button class="ppp-step" type="button" aria-label="Fewer columns">${ICONS.larger}<span>Fewer columns</span></button>
        <button class="ppp-reset" type="button" aria-label="Reset tile size">${ICONS.reset}<span>Reset</span></button>
      </div>
      ${cursorAt(thumbX, 15, 16)}
    </section>
  </div></div>`);
}

function toggle(label, checked) {
  return `<label class="ppp-c-check"><input type="checkbox" role="switch"${checked ? ' checked' : ''} /><span>${label}</span></label>`;
}

/**
 * The collection panel, built from the same class names as the real one and
 * styled by its real stylesheet. `cursor` names the control the pointer rests on.
 */
function collectionPanel({
  height, total, folderCount, chips, kind = 'all', shapes = [], hues = [],
  status, statusActions = [], tiles, selected = 0, scanning = null, note = '', cursor = null,
}) {
  const point = (name, x, y, size = 26) => (cursor === name ? cursorAt(x, y, size) : '');
  const tileHtml = tiles.map(([key, { picked = false, video = false } = {}]) => {
    const [file, title, ratio] = PINS[key];
    return `<div class="ppp-c-item"><button class="ppp-c-tile" type="button" aria-pressed="${picked}" aria-label="${title}">
      <img src="media/${file}" alt="" style="aspect-ratio:${ratio}" /><span class="ppp-c-tick">${UI_ICONS.check}</span>${video ? '<span class="ppp-c-badge">Video</span>' : ''}
    </button></div>`;
  }).join('');
  const downloadLabel = selected > 0 ? `Download ${selected} selected` : 'Download all';
  return `<aside class="ppp-c-panel scene-panel" style="height:${height}px">
    <header class="ppp-c-head"><div class="ppp-c-head-text"><h2 class="ppp-c-title">Collection</h2><p class="ppp-c-sub">${total} pins · ${folderCount} folders</p></div><button class="ppp-c-icon" type="button" aria-label="Close">${ICONS.close}</button></header>
    <section class="ppp-c-section ppp-c-card ppp-c-scan">
      <div class="ppp-c-scan-row">
        <button class="ppp-c-primary ppp-c-grow" type="button" data-busy="${Boolean(scanning)}" style="position:relative">${scanning ? `${ICONS.close}<span>Stop scanning</span>` : `${UI_ICONS.scan}<span>Scan 100 pins</span>`}${point('scan', 150, 24)}</button>
        <div class="ppp-c-seg">${[50, 100, 250].map((n) => `<button type="button" aria-pressed="${n === 100}">${n}</button>`).join('')}</div>
      </div>
      <div class="ppp-c-checks">${toggle('Skip ads', true)}${toggle('Skip repeats', false)}</div>
    </section>
    <nav class="ppp-c-folders">${chips.map(([label, count, pressed, folder]) => `<button class="ppp-c-chip" type="button" aria-pressed="${pressed}">${folder ? UI_ICONS.folder : ''}<span>${label}</span><b>${count}</b></button>`).join('')}<button class="ppp-c-chip" type="button" data-add="true" aria-label="New folder">${UI_ICONS.plus}</button></nav>
    <section class="ppp-c-section ppp-c-card ppp-c-filters">
      <div class="ppp-c-filter-line">
        <div class="ppp-c-seg" data-size="small">${[['all', 'All'], ['image', 'Images'], ['video', 'Videos']].map(([value, label]) => `<button type="button" aria-pressed="${value === kind}">${label}</button>`).join('')}</div>
        <div class="ppp-c-seg" data-size="small" data-icons="true">${['portrait', 'square', 'landscape'].map((shape) => `<button type="button" aria-pressed="${shapes.includes(shape)}">${SHAPE_ICON[shape]}</button>`).join('')}</div>
      </div>
      <div class="ppp-c-swatches">${Object.entries(HUE_SWATCH).map(([hue, paint]) => `<button class="ppp-c-swatch" type="button" aria-pressed="${hues.includes(hue)}" style="position:relative;background:${paint}">${point(`hue:${hue}`, 14, 15, 24)}</button>`).join('')}</div>
    </section>
    <div class="ppp-c-status"><span>${status}</span><span class="ppp-c-status-actions">${statusActions.map((label) => `<button class="ppp-c-link" type="button">${label}</button>`).join('')}</span></div>
    <div class="ppp-c-scroll"><div class="ppp-c-grid" data-selecting="${selected > 0}">${tileHtml}</div></div>
    <footer class="ppp-c-foot">
      ${selected > 0 ? `<div class="ppp-c-selection"><span>${selected} selected</span><button class="ppp-c-link" type="button">Clear</button><button class="ppp-c-link" type="button" data-danger="true">Remove</button><select class="ppp-c-select"><option>Move to…</option></select></div>` : ''}
      <div class="ppp-c-foot-row">
        <div class="ppp-c-seg"><button type="button" aria-pressed="true">ZIP</button><button type="button" aria-pressed="false">Files</button></div>
        <button class="ppp-c-primary ppp-c-grow" type="button"${scanning ? ' disabled' : ''} style="position:relative">${ICONS.download}<span>${downloadLabel}</span>${point('download', 168, 24)}</button>
      </div>
      <div class="ppp-c-checks">${toggle('Add sources.csv with each pin’s link', true)}</div>
      ${scanning ? `<div class="ppp-c-busy" role="status"><div class="ppp-c-busy-text"><span>Scanning the page</span><span>${scanning[0]} / ${scanning[1]}</span></div><div class="ppp-c-bar"><span style="width:${(scanning[0] / scanning[1]) * 100}%"></span></div></div>` : ''}
      ${note ? `<p class="ppp-c-note">${note}</p>` : ''}
    </footer>
  </aside>`;
}

function mediaPicker({ left, top, zoom, eyebrow, items }) {
  return placed({ left, top, zoom }, `<div class="ppp-root">
    <section class="ppp-media-picker" role="dialog">
      <div class="ppp-picker-header">
        <div class="ppp-picker-title-block">
          <span class="ppp-picker-eyebrow">${eyebrow}</span>
          <span class="ppp-picker-title">Choose media</span>
          <span class="ppp-picker-subtitle">${items.length} items available</span>
        </div>
        <button class="ppp-picker-close" type="button">${ICONS.close}<span>Close</span></button>
      </div>
      <div class="ppp-picker-scroll"><div class="ppp-picker-grid">
        ${items.map(([key, label, video], index) => `
          <button class="ppp-media-option" type="button" style="position:relative">
            <span class="ppp-media-preview-wrap"><img class="ppp-media-preview" src="media/${PINS[key][0]}" alt="" style="object-fit:cover" />
              ${video ? '<span class="ppp-media-kind">Video</span>' : ''}</span>
            <span class="ppp-media-label">${label}</span>
            ${index === 0 ? cursorAt(92, 66, 24) : ''}
          </button>`).join('')}
      </div></div>
    </section>
  </div>`);
}

function page(title, width, height, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>${title}</title>
${FONTS}
<style>${shadowCss}\n${collectionCss}\n${sceneCss}\nhtml, body { width: ${width}px; height: ${height}px; }</style></head>
<body>${body}</body></html>`;
}

const SHOT_W = 1280;
const SHOT_H = 800;
/** The product window every feed shot shares: centred, cropped by the bottom edge. */
const WINDOW = { left: 160, top: 250, width: 960, height: 620 };
/** White light behind the window; the balance shifts a little per frame so the set does not repeat. */
const GLOW = {
  left: [[-60, 160, 620, 'var(--light)', 0.13], [700, 210, 620, 'var(--mist)', 0.1], [340, 150, 600, 'var(--light)', 0.08]],
  right: [[-20, 210, 600, 'var(--mist)', 0.1], [680, 150, 640, 'var(--light)', 0.14], [340, 150, 600, 'var(--light)', 0.08]],
  centre: [[60, 190, 560, 'var(--light)', 0.1], [640, 190, 560, 'var(--light)', 0.1], [300, 120, 680, 'var(--mist)', 0.12]],
};

/** A small leading icon for a heading's points. */
const POINT = {
  scan: UI_ICONS.scan,
  folder: UI_ICONS.folder,
  zip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M10 6h1M10 9h1M10 12h1M10 15v2h2v-2z"/></svg>',
  palette: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="8.5" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="15.5" cy="10" r="1"/></svg>',
  ads: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
};

const FOLDER_CHIPS = [['All', 86, false], ['Unfiled', 31, false], ['Moodboard', 24, true, true], ['Kitchen', 18, false, true], ['Packaging', 13, false, true]];

const scenes = {
  'screenshot-1-copy-download.html': page('Save any pin', SHOT_W, SHOT_H, `
    ${backdrop(GLOW.left)}
    ${heading({ title: 'Save any pin in full quality.', sub: 'Copy, Download and Collect sit right on the pin you point at. You get the original file, not a thumbnail.' })}
    ${browser({
      ...WINDOW, zoom: 1.3,
      inner: columns([
        [pin('living'), pin('flowers')],
        [pin('greece', { hovered: true, pointing: 'download' }), pin('tart')],
        [pin('granola'), pin('kitchen')],
      ]),
    })}
  `),

  'screenshot-2-collection.html': page('Your own collection', SHOT_W, SHOT_H, `
    ${backdrop(GLOW.right)}
    ${sideHeading({
      left: 84, top: 196, width: 400,
      title: 'Collect pins. Save them all at once.',
      sub: 'One click keeps a pin in your own panel. Sort pins into folders, then download the lot.',
      points: [[POINT.folder, 'Folders, kept on your device'], [POINT.zip, 'One ZIP, or every file apart'], [POINT.video, 'Videos and full-size originals']],
    })}
    ${browser({
      left: 520, top: 40, width: 728, height: 744, zoom: 1,
      inner: columns([
        [pin('vases', { hovered: true, visit: false, collected: true, board: false }), pin('living')],
        [pin('shapes'), pin('kitchen')],
        [pin('nook'), pin('bath')],
        [pin('flowers'), pin('cat')],
      ]),
      overlay: collectionPanel({
        height: 678, total: 86, folderCount: 3, chips: FOLDER_CHIPS,
        status: '24 pins', statusActions: ['Rename', 'Delete folder'],
        tiles: [['vases', { picked: true }], ['kitchen', { picked: true }], ['living', { picked: true }], ['nook', { picked: true }], ['shapes', { picked: true }], ['bath'], ['concrete'], ['plants'], ['sketch']],
        selected: 5, cursor: 'download',
      }),
    })}
  `),

  'screenshot-3-scan-filter.html': page('Scan and filter', SHOT_W, SHOT_H, `
    ${backdrop(GLOW.left)}
    ${browser({
      left: 32, top: 40, width: 728, height: 744, zoom: 1,
      inner: columns([
        [pin('granola'), pin('greece')],
        [pin('sunset'), pin('coat')],
        [pin('tart'), pin('plants')],
        [pin('flowers'), pin('living')],
      ]),
      overlay: collectionPanel({
        height: 678, total: 64, folderCount: 3,
        chips: [['All', 64, true], ['Unfiled', 64, false], ['Moodboard', 0, false, true], ['Kitchen', 0, false, true]],
        shapes: ['portrait'], hues: ['orange', 'yellow'],
        status: '18 of 64 shown', statusActions: ['Reset filters'],
        tiles: [['granola'], ['sunset', { video: true }], ['tart'], ['flowers'], ['coat'], ['greece'], ['living'], ['vases'], ['nook']],
        scanning: [64, 100], cursor: 'hue:yellow',
      }),
    })}
    ${sideHeading({
      left: 812, top: 196, width: 400,
      title: 'Scan the feed. Filter by colour.',
      sub: 'Scan scrolls for you and gathers up to 250 pins. Then keep just the shape and colours you need.',
      points: [[POINT.ads, 'Skips ads, and repeats if you like'], [POINT.palette, 'Matches every colour in a picture'], [SHAPE_ICON.portrait, 'Portrait, square or landscape']],
    })}
  `),

  'screenshot-4-videos.html': page('Videos too', SHOT_W, SHOT_H, `
    ${backdrop(GLOW.right)}
    ${heading({ title: 'Videos too. Every slide.', sub: 'A carousel opens a picker, and each video saves as a real MP4, even when Pinterest only streams it.' })}
    ${browser({
      ...WINDOW, zoom: 1.3,
      inner: columns([
        [pin('sunset', { duration: '0:24' }), pin('vases')],
        [pin('concrete', { duration: '0:18' }), pin('cat')],
        [pin('plants'), pin('nook', { duration: '0:31' })],
      ]),
    })}
    ${mediaPicker({
      left: 446, top: 300, zoom: 1.15, eyebrow: 'Save to device',
      items: [['sunset', 'Video 1', true], ['greece', 'Video 2', true], ['concrete', 'Video 3', true], ['shapes', 'Video 4', true]],
    })}
  `),

  'screenshot-5-grid-slider.html': page('Resize the grid', SHOT_W, SHOT_H, `
    ${backdrop(GLOW.centre)}
    ${heading({ title: 'Resize the grid in one drag.', sub: 'Smaller tiles to see more at once, bigger ones for the detail. Your collection is one click away.' })}
    ${browser({
      ...WINDOW, zoom: 1,
      inner: columns([
        [pin('flowers'), pin('bath')],
        [pin('shapes'), pin('kitchen')],
        [pin('nook'), pin('sketch')],
        [pin('concrete'), pin('cat')],
        [pin('granola'), pin('living')],
      ]),
    })}
    ${gridPanel({ left: 650, top: 652, zoom: 1.7, value: '156px · 5 cols', current: 172, collected: 86 })}
  `),
};

const KEY = '../brand/keycap-master.png';

/** The key itself as the hero: lit from above, its own white glow pooling beneath it. */
function heroKey({ left, top, size }) {
  return `<div style="position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px;z-index:4">
    <div style="position:absolute;left:12%;right:12%;bottom:-6%;height:22%;border-radius:50%;background:#fff;opacity:.16;filter:blur(${size * 0.16}px)"></div>
    <img src="${KEY}" alt="" style="position:relative;display:block;width:100%;height:100%;filter:drop-shadow(0 ${size * 0.1}px ${size * 0.14}px rgba(0,0,0,.7))" />
  </div>`;
}

const promoSmall = page('Small promo', 440, 280, `
  <div class="gridlines" style="background-size:28px 28px;-webkit-mask-image:radial-gradient(ellipse 60% 60% at 50% 40%, #000, transparent 75%)"></div>
  <div class="beams" style="left:-200px;right:-200px;top:-300px;height:900px;background-size:auto;-webkit-mask-image:radial-gradient(ellipse 45% 35% at 50% 38%, #000, transparent 72%)"></div>
  ${glows([[100, 20, 240, 'var(--light)', 0.12]])}
  ${heroKey({ left: 166, top: 30, size: 108 })}
  <div style="position:absolute;left:0;right:0;top:158px;z-index:5;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center">
    <div style="font-size:25px;line-height:1.05;font-weight:700;letter-spacing:-.04em;color:#fff">Pinterest Plus Plus</div>
    <div style="color:#8e8e96;font-size:14px;line-height:1.4">Save pins, videos and whole boards</div>
  </div>
`);

const promoMarquee = page('Marquee', 1400, 560, `
  <div class="gridlines" style="-webkit-mask-image:radial-gradient(ellipse 50% 70% at 74% 48%, #000, transparent 75%)"></div>
  <div class="beams" style="-webkit-mask-image:radial-gradient(ellipse 40% 60% at 72% 40%, #000, transparent 72%)"></div>
  ${glows([[820, 60, 560, 'var(--light)', 0.12], [900, 200, 420, 'var(--mist)', 0.1]])}
  <div style="position:absolute;left:104px;top:0;bottom:0;width:560px;z-index:5;display:flex;flex-direction:column;justify-content:center;gap:20px">
    <span class="brand" style="align-self:flex-start"><img src="../../public/icon/128.png" alt="" />Pinterest Plus Plus</span>
    <h1 style="font-size:68px;font-weight:700">Save any pin.<br />Or all of them.</h1>
    <p class="sub" style="font-size:20px;max-width:470px;text-wrap:pretty">Full-quality images, videos and every carousel slide in one click. Collect pins into folders and download them as one ZIP.</p>
  </div>
  ${heroKey({ left: 880, top: 110, size: 330 })}
`);

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

async function captureWithPlaywright(file, outfile, width, height) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return false;
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outfile, type: 'png' });
  } finally {
    await browser.close();
  }
  return true;
}

async function captureWithChrome(chrome, file, outfile, width, height) {
  // A profile of its own: pointed at the user's default one, headless Chrome
  // would share (or fight over) the browser they are using.
  const profile = await mkdtemp(join(tmpdir(), 'ppp-store-'));
  try {
    await run(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      // Lets the web font and the pictures load before the frame is taken.
      '--virtual-time-budget=15000',
      '--run-all-compositor-stages-before-draw',
      `--screenshot=${outfile}`,
      '--default-background-color=FFFFFFFF',
      pathToFileURL(file).href,
    ]);
  } finally {
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

/** The store wants exact sizes and no alpha channel. */
async function flattenExact(file, width, height) {
  const image = sharp(file);
  const meta = await image.metadata();
  await image
    .extract({ left: 0, top: 0, width: Math.min(meta.width ?? width, width), height: Math.min(meta.height ?? height, height) })
    .flatten({ background: '#ffffff' })
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(`${file}.tmp.png`);
  await rename(`${file}.tmp.png`, file);
}

await mkdir(scenesDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });

for (const [name, html] of Object.entries(scenes)) {
  await writeFile(join(scenesDir, name), html);
}
await writeFile(join(scenesDir, 'promo-small.html'), promoSmall);
await writeFile(join(scenesDir, 'promo-marquee.html'), promoMarquee);
await copyFile(iconSrc, join(assetsDir, 'icon-128.png'));

const shots = [
  ['screenshot-1-copy-download.html', 'screenshot-1-copy-download.png', SHOT_W, SHOT_H],
  ['screenshot-2-collection.html', 'screenshot-2-collection.png', SHOT_W, SHOT_H],
  ['screenshot-3-scan-filter.html', 'screenshot-3-scan-filter.png', SHOT_W, SHOT_H],
  ['screenshot-4-videos.html', 'screenshot-4-videos.png', SHOT_W, SHOT_H],
  ['screenshot-5-grid-slider.html', 'screenshot-5-grid-slider.png', SHOT_W, SHOT_H],
  ['promo-small.html', 'promo-small-440x280.png', 440, 280],
  ['promo-marquee.html', 'promo-marquee-1400x560.png', 1400, 560],
];

const only = process.argv.slice(2);
const chrome = await findChrome();
for (const [scene, asset, width, height] of shots) {
  if (only.length && !only.some((name) => scene.includes(name))) continue;
  const input = join(scenesDir, scene);
  const output = join(assetsDir, asset);
  const usedPlaywright = await captureWithPlaywright(input, output, width, height);
  if (!usedPlaywright) {
    if (!chrome) throw new Error('Need Chrome, Edge, or Playwright to capture store assets');
    await captureWithChrome(chrome, input, output, width, height);
  }
  await flattenExact(output, width, height);
}

console.log('Wrote store assets to store/assets');
