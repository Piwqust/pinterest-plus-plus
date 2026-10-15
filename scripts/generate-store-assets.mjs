import { spawn } from 'node:child_process';
import { mkdir, readFile, copyFile, access, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

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
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0-4 4m4-4 4 4"/><path d="M6 13v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-5"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6 14.4 8.6l5.5.8-4 3.9.9 5.4L12 16.2 7.2 18.7l.9-5.4-4-3.9 5.5-.8z"/></svg>',
};

const src = await readFile(join(root, 'shared', 'ui-assets.ts'), 'utf8');
const shadowMatch = src.match(/export const SHADOW_CSS = `([\s\S]*?)`;/);
if (!shadowMatch) throw new Error('Could not read SHADOW_CSS');
const shadowCss = shadowMatch[1].replaceAll(':host', '.ppp-root');

const mockCss = `
  html { margin: 0; width: 1280px; height: 800px; background: #f0efe9; }
  body { position: absolute; top: 0; left: 0; margin: 0; width: 1280px; height: 800px; overflow: hidden; background: #f0efe9; }
  body {
    font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Helvetica Neue", Arial, sans-serif;
    color: #2f2f2e;
  }
  .caption {
    height: 64px; display: flex; align-items: center; padding: 0 28px;
    color: #fff; background: #2f2f2e; font-size: 22px; font-weight: 650; letter-spacing: -.02em;
  }
  .page { height: 736px; background: #fff; }
  .topbar {
    height: 58px; display: flex; align-items: center; gap: 12px; padding: 0 22px;
    border-bottom: 1px solid #eee;
  }
  .mark {
    width: 32px; height: 32px; border-radius: 10px; background: #c4102f;
    display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 7px;
  }
  .mark i { display: block; border-radius: 2px; background: #fff; }
  .mark i:nth-child(1) { height: 14px; }
  .mark i:nth-child(2) { height: 8px; margin-top: 6px; }
  .mark i:nth-child(3) { height: 8px; }
  .mark i:nth-child(4) { height: 14px; }
  .search {
    flex: 1; height: 40px; border: 0; border-radius: 24px; background: #efefef;
    padding: 0 18px; color: #787774; font: 500 14px/40px inherit;
  }
  .avatar { width: 32px; height: 32px; border-radius: 50%; background: #d9c2b0; }
  .feed { padding: 16px 22px 0; column-count: 5; column-gap: 16px; height: 662px; overflow: hidden; }
  .feed.wide { column-count: 3; }
  .feed.board { column-count: 4; }
  .pin { break-inside: avoid; margin: 0 0 16px; }
  .media {
    position: relative; overflow: hidden; border-radius: 16px; background: var(--g);
    height: var(--h); box-shadow: inset 0 0 0 1px rgba(0,0,0,.04);
  }
  .media::after {
    position: absolute; inset: auto 12px 12px 12px; height: 42%;
    background: linear-gradient(transparent, rgba(0,0,0,.18)); content: "";
    pointer-events: none; border-radius: 0 0 16px 16px;
  }
  .overlay {
    position: absolute; inset: 0; display: flex; justify-content: flex-end;
    align-items: flex-start; padding: 10px; background: rgba(0,0,0,.24);
  }
  .corner-icons { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 8px; }
  .round {
    width: 32px; height: 32px; border: 0; border-radius: 50%; background: #fff; color: #2f2f2e;
    display: grid; place-items: center;
  }
  .round svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .round.dots svg { fill: currentColor; stroke: none; }
  .visit {
    position: absolute; left: 12px; bottom: 12px; height: 32px; padding: 0 12px; border-radius: 16px;
    display: flex; align-items: center; background: rgba(255,255,255,.92); color: #2f2f2e; font-size: 12px; font-weight: 650;
  }
  .overlay, .corner-icons, .visit, .hover-panel { z-index: 1; }
  .hover-panel { position: absolute; left: 12px; bottom: 12px; line-height: 0; }
  .hover-panel.lifted { bottom: 52px; }
  .save {
    height: 36px; padding: 0 14px; border: 0; border-radius: 18px;
    color: #fff; background: #e60023; font: 700 13px/36px inherit;
  }
  .footer {
    display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px 2px 0;
  }
  .title { flex: 1; min-width: 0; font-size: 12px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .star {
    width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent; color: #2f2f2e;
    display: grid; place-items: center;
  }
  .star svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; }
  .closeup { display: grid; grid-template-columns: 1fr 340px; height: 678px; }
  .hero { margin: 20px 0 20px 28px; border-radius: 20px; background: linear-gradient(160deg, #c46a4a, #8a3d2f 55%, #3f2a24); }
  .side { padding: 22px 22px 0 18px; }
  .bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 16px; }
  .bar .ppp-action { background: #efefef; }
  .save-lg {
    height: 40px; padding: 0 16px; border: 0; border-radius: 20px;
    color: #fff; background: #e60023; font: 700 14px/40px inherit;
  }
  .menu-lg {
    width: 40px; height: 40px; border: 0; border-radius: 50%; background: #efefef; color: #2f2f2e;
    display: grid; place-items: center;
  }
  .menu-lg svg { width: 18px; height: 18px; fill: currentColor; }
  .related { column-count: 2; column-gap: 12px; }
  .toast {
    position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%);
    padding: 11px 15px; border: 1px solid #2f2f2e; border-radius: 8px;
    color: #fff; background: #2f2f2e; font-weight: 600;
  }
  .ppp-root { font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Helvetica Neue", Arial, sans-serif; }
  .ppp-grid-shell { opacity: 1 !important; }
  .picker-wrap { position: fixed; left: 430px; top: 168px; }
`;

function pin(h, g) {
  return `<article class="pin"><div class="media" style="--h:${h}px;--g:${g}"></div></article>`;
}

/**
 * Pinterest's own hover state, with the extension's panel laid over the
 * media's lower-left corner — lifted above "Visit site" when the pin has one.
 */
function hoverLayer(visit) {
  return `
    <div class="overlay"><button class="save" type="button">Save</button></div>
    ${visit ? `<span class="visit">${visit}</span>` : ''}
    <div class="corner-icons">
      <button class="round" type="button">${ICONS.share}</button>
      <button class="round dots" type="button">${ICONS.dots}</button>
    </div>
    <span class="hover-panel${visit ? ' lifted' : ''}">${actionsHtml('grid')}</span>`;
}

function overlayPin(h, g, { hovered = false } = {}) {
  return `<article class="pin"><div class="media" style="--h:${h}px;--g:${g}">${hovered ? hoverLayer() : ''}</div></article>`;
}

function boardPin(h, g, title, { hovered = false, visit = '' } = {}) {
  return `<article class="pin">
    <div class="media" style="--h:${h}px;--g:${g}">${hovered ? hoverLayer(visit) : ''}</div>
    <div class="footer">
      <div class="title">${title}</div>
      <button class="star" type="button">${ICONS.star}</button>
    </div>
  </article>`;
}

function actionsHtml(scope) {
  return `<span class="ppp-root"><span class="ppp-pin-actions" data-scope="${scope}">
    <button class="ppp-action" type="button" aria-label="Copy media">${ICONS.copy}<span>Copy media</span></button>
    <button class="ppp-action" type="button" aria-label="Download media">${ICONS.download}<span>Download media</span></button>
  </span></span>`;
}

function gridPanel(value = '236px · 5 cols', max = 420, current = 236) {
  return `<div class="ppp-root"><div class="ppp-grid-shell">
    <section class="ppp-grid-panel" aria-label="Grid tile size">
      <label class="ppp-range-row">
        <input class="ppp-range" type="range" min="160" max="${max}" step="4" value="${current}" aria-label="Tile width" />
      </label>
      <div class="ppp-grid-foot">
        <button class="ppp-step" type="button" aria-label="More columns">${ICONS.smaller}<span>More columns</span></button>
        <span class="ppp-grid-value">${value}</span>
        <button class="ppp-step" type="button" aria-label="Fewer columns">${ICONS.larger}<span>Fewer columns</span></button>
        <button class="ppp-reset" type="button" aria-label="Reset tile size">${ICONS.reset}<span>Reset</span></button>
      </div>
    </section>
  </div></div>`;
}

function chromeTop() {
  return `<header class="topbar">
    <div class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="search">Search inspiration</div>
    <div class="avatar"></div>
  </header>`;
}

function page(caption, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>${caption}</title>
<style>${shadowCss}\n${mockCss}</style></head>
<body>
  <div class="caption">${caption}</div>
  <div class="page">${inner}</div>
</body></html>`;
}

const G = {
  a: 'linear-gradient(165deg,#e7cbb3 0%,#c17a5a 48%,#6d3a2d 100%)',
  b: 'linear-gradient(165deg,#d7e2d4 0%,#7f9b78 52%,#2f4630 100%)',
  c: 'linear-gradient(165deg,#f0e2c4 0%,#d1a15a 50%,#7a4b22 100%)',
  d: 'linear-gradient(165deg,#ead7d7 0%,#b36b73 48%,#5c2d38 100%)',
  e: 'linear-gradient(165deg,#d9e3ee 0%,#6d8eae 52%,#24364a 100%)',
  f: 'linear-gradient(165deg,#e6dcc8 0%,#9a8a6c 50%,#3f382c 100%)',
  g: 'linear-gradient(165deg,#f3d6c4 0%,#de8b63 46%,#8a3e28 100%)',
  h: 'linear-gradient(165deg,#cfd6c8 0%,#8ea08a 50%,#3c4a3e 100%)',
};

const scenes = {
  'screenshot-1-copy-download.html': page(
    'Point at a pin — Copy and Download appear in its corner',
    `${chromeTop()}<div class="feed">
      ${overlayPin(268, G.a)}
      ${overlayPin(210, G.b)}
      ${overlayPin(248, G.c, { hovered: true })}
      ${overlayPin(186, G.d)}
      ${overlayPin(230, G.e)}
      ${overlayPin(200, G.f)}
      ${overlayPin(240, G.g)}
      ${overlayPin(176, G.h)}
      ${overlayPin(220, G.a)}
      ${overlayPin(198, G.b)}
    </div>${gridPanel()}<div class="toast">Copied</div>`,
  ),
  'screenshot-2-boards.html': page(
    'Boards and profiles too — clear of Pinterest’s own buttons',
    `${chromeTop()}<div class="feed board">
      ${boardPin(250, G.c, 'Stoneware bottle')}
      ${boardPin(198, G.e, 'North window')}
      ${boardPin(276, G.b, 'Olive branches', { hovered: true, visit: 'example.com' })}
      ${boardPin(214, G.d, 'Linen study')}
      ${boardPin(232, G.a, 'Terracotta wall')}
      ${boardPin(188, G.f, 'Oak interior')}
      ${boardPin(260, G.h, 'Garden path')}
      ${boardPin(206, G.g, 'Clay bowls')}
    </div>${gridPanel('252px · 4 cols', 360, 252)}`,
  ),
  'screenshot-3-grid-slider.html': page(
    'Resize the masonry from two columns up — Pinterest reflows it',
    `${chromeTop()}<div class="feed wide">
      ${pin(340, G.a)}${pin(280, G.e)}${pin(310, G.b)}
      ${pin(260, G.c)}${pin(300, G.d)}${pin(240, G.f)}
    </div>${gridPanel('392px · 3 cols', 420, 392)}`,
  ),
  'screenshot-4-closeup.html': page(
    'Close-up actions match Pinterest’s bar and target this pin',
    `${chromeTop()}<div class="closeup">
      <div class="hero"></div>
      <aside class="side">
        <div class="bar">
          <button class="save-lg" type="button">Save</button>
          ${actionsHtml('closeup')}
          <button class="menu-lg" type="button">${ICONS.dots}</button>
        </div>
        <div class="related">
          ${pin(160, G.b)}${pin(128, G.c)}${pin(148, G.d)}${pin(120, G.e)}
        </div>
      </aside>
    </div>`,
  ),
  'screenshot-5-media-picker.html': page(
    'Carousels open a picker — choose the slide to copy or save',
    `${chromeTop()}<div class="feed">
      ${overlayPin(240, G.a)}${overlayPin(200, G.b)}${overlayPin(260, G.c)}
      ${overlayPin(188, G.d)}${overlayPin(220, G.e)}${overlayPin(176, G.f)}
      ${overlayPin(230, G.g)}${overlayPin(196, G.h)}
    </div>
    <div class="picker-wrap ppp-root">
      <section class="ppp-media-picker" role="dialog" aria-label="Choose media to copy">
        <div class="ppp-picker-header">
          <div class="ppp-picker-title-block">
            <span class="ppp-picker-eyebrow">Copy to clipboard</span>
            <span class="ppp-picker-title">Choose media</span>
            <span class="ppp-picker-subtitle">4 items available</span>
          </div>
          <button class="ppp-picker-close" type="button">${ICONS.close}<span>Close</span></button>
        </div>
        <div class="ppp-picker-scroll">
          <div class="ppp-picker-grid">
            ${['Image 1', 'Image 2', 'Video 1', 'Image 3'].map((label, i) => `
              <button class="ppp-media-option" type="button">
                <span class="ppp-media-preview-wrap" style="background:${[G.a, G.e, G.b, G.c][i]}">
                  ${label.startsWith('Video') ? '<span class="ppp-media-kind">Video</span>' : ''}
                </span>
                <span class="ppp-media-label">${label}</span>
              </button>`).join('')}
          </div>
        </div>
      </section>
    </div>${gridPanel()}`,
  ),
};

const promoSmall = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>Small promo</title>
<style>
  html { margin: 0; width: 440px; height: 280px; }
  body { position: absolute; top: 0; left: 0; margin: 0; width: 440px; height: 280px; overflow: hidden; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
    background: linear-gradient(160deg, #e31b47 0%, #c4102f 55%, #8e0b2e 100%);
    font: 700 28px/1.05 -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Helvetica Neue", Arial, sans-serif;
    color: #fff;
  }
  img { width: 88px; height: 88px; border-radius: 22px; box-shadow: 0 10px 24px rgba(70, 0, 20, .28); }
  h1 { margin: 0; font-size: 28px; letter-spacing: -.03em; }
  p { margin: 0; color: #ffd6dc; font-size: 15px; font-weight: 650; letter-spacing: .04em; }
</style></head>
<body>
  <img src="../../public/icon/128.png" alt="" />
  <h1>Pinterest Plus Plus</h1>
  <p>Copy · Download · Resize</p>
</body></html>`;

const promoMarquee = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>Marquee</title>
<style>
  html { margin: 0; width: 1400px; height: 560px; }
  body { position: absolute; top: 0; left: 0; margin: 0; width: 1400px; height: 560px; overflow: hidden; }
  body {
    background: linear-gradient(160deg, #e31b47 0%, #c4102f 52%, #8e0b2e 100%);
    font: 700 64px/1 -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Helvetica Neue", Arial, sans-serif;
    color: #fff;
  }
  .copy { position: absolute; left: 80px; top: 50%; transform: translateY(-50%); }
  .brand { display: flex; align-items: center; gap: 24px; margin-bottom: 20px; }
  img { width: 104px; height: 104px; border-radius: 26px; box-shadow: 0 16px 36px rgba(70, 0, 20, .3); }
  h1 { margin: 0; font-size: 48px; letter-spacing: -.035em; }
  p { margin: 0; color: #ffd6dc; font-size: 24px; font-weight: 650; }
  .tiles {
    position: absolute; right: 80px; top: 50%; transform: translateY(-50%);
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px; width: 360px; height: 328px;
  }
  .tiles .col { display: grid; gap: 18px; }
  .tiles span { display: block; border-radius: 16px; background: #fff; box-shadow: 0 10px 28px rgba(70, 0, 20, .22); }
  .tiles .tall { height: 196px; }
  .tiles .short { height: 116px; }
</style></head>
<body>
  <div class="copy">
    <div class="brand">
      <img src="../../public/icon/128.png" alt="" />
      <h1>Pinterest Plus Plus</h1>
    </div>
    <p>Copy · Download · Resize the grid</p>
  </div>
  <div class="tiles" aria-hidden="true">
    <div class="col"><span class="tall"></span><span class="short"></span></div>
    <div class="col"><span class="short"></span><span class="tall"></span></div>
  </div>
</body></html>`;

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
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
    await page.screenshot({ path: outfile, type: 'png' });
  } finally {
    await browser.close();
  }
  return true;
}

async function captureWithChrome(chrome, file, outfile, width, height) {
  await run(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--force-device-scale-factor=1`,
    `--window-size=${width},${height}`,
    `--screenshot=${outfile}`,
    '--default-background-color=FFFFFFFF',
    pathToFileURL(file).href,
  ]);
}

async function flattenExact(file, width, height) {
  const image = sharp(file);
  const meta = await image.metadata();
  const extractWidth = Math.min(meta.width ?? width, width);
  const extractHeight = Math.min(meta.height ?? height, height);
  await image
    .extract({ left: 0, top: 0, width: extractWidth, height: extractHeight })
    .flatten({ background: '#ffffff' })
    .resize(width, height, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(file + '.tmp.png');
  await rename(file + '.tmp.png', file);
  return { width: meta.width, height: meta.height };
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
  ['screenshot-1-copy-download.html', 'screenshot-1-copy-download.png', 1280, 800],
  ['screenshot-2-boards.html', 'screenshot-2-boards.png', 1280, 800],
  ['screenshot-3-grid-slider.html', 'screenshot-3-grid-slider.png', 1280, 800],
  ['screenshot-4-closeup.html', 'screenshot-4-closeup.png', 1280, 800],
  ['screenshot-5-media-picker.html', 'screenshot-5-media-picker.png', 1280, 800],
  ['promo-small.html', 'promo-small-440x280.png', 440, 280],
  ['promo-marquee.html', 'promo-marquee-1400x560.png', 1400, 560],
];

const chrome = await findChrome();
for (const [scene, asset, width, height] of shots) {
  const input = join(scenesDir, scene);
  const output = join(assetsDir, asset);
  const usedPlaywright = await captureWithPlaywright(input, output, width, height);
  if (!usedPlaywright) {
    if (!chrome) throw new Error('Need Chrome, Edge, or Playwright to capture store assets');
    await captureWithChrome(chrome, input, output, width, height);
  }
  await flattenExact(output, width, height);
}

console.log(`Wrote ${shots.length} store assets to store/assets`);
