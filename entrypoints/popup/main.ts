import {
  DEFAULT_TILE_WIDTH,
  MIN_TILE_WIDTH,
  POPUP_MAX_TILE_WIDTH,
  TILE_STEP,
  clampTileWidth,
  readSettings,
  writeTileWidth,
} from '../../shared/settings';

const PINTEREST_URL = 'https://www.pinterest.com/';
const SETTINGS_WRITE_DEBOUNCE = 400;
const DEFAULT_NOTE = 'Applies to open Pinterest tabs.';

const range = document.querySelector<HTMLInputElement>('#range')!;
const value = document.querySelector<HTMLOutputElement>('#value')!;
const note = document.querySelector<HTMLElement>('#note')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const open = document.querySelector<HTMLButtonElement>('#open')!;
const version = document.querySelector<HTMLElement>('#version')!;

let writeTimer: number | undefined;

function showWidth(width: number): void {
  value.textContent = `${width} px`;
}

function setNote(message: string, isError = false): void {
  note.textContent = message;
  note.dataset.error = String(isError);
}

/**
 * The stored width is written straight to `chrome.storage.sync`. Every open
 * Pinterest tab already listens for that key, so the grid reflows without the
 * popup needing to reach into a tab — and therefore without a tabs permission.
 */
function persist(width: number): void {
  if (writeTimer !== undefined) window.clearTimeout(writeTimer);
  writeTimer = window.setTimeout(() => {
    writeTimer = undefined;
    void writeTileWidth(width).then(
      () => setNote(DEFAULT_NOTE),
      () => setNote('Could not save to your Chrome profile.', true),
    );
  }, SETTINGS_WRITE_DEBOUNCE);
}

function apply(width: number): void {
  const normalized = clampTileWidth(width, Number(range.max));
  range.value = String(normalized);
  showWidth(normalized);
  persist(normalized);
}

async function start(): Promise<void> {
  version.textContent = `Version ${chrome.runtime.getManifest().version}`;
  range.min = String(MIN_TILE_WIDTH);
  range.step = String(TILE_STEP);

  const { tileWidth } = await readSettings();
  // A preference set from the page's own slider can exceed the popup's range,
  // which is built without a grid to measure. Widening the track to fit keeps
  // opening the popup from quietly snapping that choice down.
  range.max = String(Math.max(POPUP_MAX_TILE_WIDTH, tileWidth));
  range.value = String(tileWidth);
  showWidth(tileWidth);
  setNote(DEFAULT_NOTE);

  range.addEventListener('input', () => showWidth(Number(range.value)));
  range.addEventListener('change', () => apply(Number(range.value)));
  reset.addEventListener('click', () => apply(DEFAULT_TILE_WIDTH));
  open.addEventListener('click', () => {
    void chrome.tabs.create({ url: PINTEREST_URL });
    window.close();
  });
}

void start();
