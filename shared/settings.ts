export const DEFAULT_TILE_WIDTH = 236;
export const MIN_TILE_WIDTH = 160;
/** Sanity ceiling for stored values. The usable maximum is derived per grid. */
export const ABSOLUTE_MAX_TILE_WIDTH = 2048;
/** Used when the real grid width cannot be measured yet. */
export const FALLBACK_MAX_TILE_WIDTH = 420;
/**
 * The popup has no Pinterest grid to measure, so it offers this range and lets
 * the on-page control — which reads the live grid — narrow the value if the
 * viewport cannot show it. A stored preference wider than this still opens at
 * its own width rather than being snapped down by merely opening the popup.
 */
export const POPUP_MAX_TILE_WIDTH = FALLBACK_MAX_TILE_WIDTH;
/** Pinterest's Masonry gutter, used until the grid reports its own. */
export const DEFAULT_GUTTER = 16;
export const TILE_STEP = 4;

export interface Settings {
  tileWidth: number;
}

function snapDown(value: number): number {
  return Math.floor(value / TILE_STEP) * TILE_STEP;
}

function safeGutter(gutter: number): number {
  return Number.isFinite(gutter) && gutter >= 0 ? gutter : DEFAULT_GUTTER;
}

export function clampTileWidth(value: unknown, max: number = ABSOLUTE_MAX_TILE_WIDTH): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  const ceiling = Number.isFinite(max)
    ? Math.min(ABSOLUTE_MAX_TILE_WIDTH, Math.max(MIN_TILE_WIDTH, max))
    : ABSOLUTE_MAX_TILE_WIDTH;
  if (!Number.isFinite(numeric)) return Math.min(ceiling, DEFAULT_TILE_WIDTH);
  const clamped = Math.min(ceiling, Math.max(MIN_TILE_WIDTH, numeric));
  const snapped = Math.round(clamped / TILE_STEP) * TILE_STEP;
  return Math.min(ceiling, Math.max(MIN_TILE_WIDTH, snapped));
}

/**
 * The widest tile the slider offers for a grid of `availableWidth`. Two columns
 * plus one gutter must still fit, so the grid never drops below two pins per row.
 */
export function maxTileWidthFor(availableWidth: number, gutter: number = DEFAULT_GUTTER): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return FALLBACK_MAX_TILE_WIDTH;
  const half = snapDown((availableWidth - safeGutter(gutter)) / 2);
  return Math.min(ABSOLUTE_MAX_TILE_WIDTH, Math.max(MIN_TILE_WIDTH, half));
}

/** The column count Masonry lands on for a given tile width. */
export function columnsForWidth(
  width: number,
  availableWidth: number,
  gutter: number = DEFAULT_GUTTER,
): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  const track = safeGutter(gutter);
  const tile = Math.max(1, Number.isFinite(width) ? width : DEFAULT_TILE_WIDTH);
  return Math.max(1, Math.floor((availableWidth + track) / (tile + track)));
}

/** The exact tile width that fills a row with `columns` tiles. */
export function widthForColumns(
  columns: number,
  availableWidth: number,
  gutter: number = DEFAULT_GUTTER,
): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return DEFAULT_TILE_WIDTH;
  const count = Math.max(1, Math.floor(Number.isFinite(columns) ? columns : 1));
  const raw = (availableWidth - safeGutter(gutter) * (count - 1)) / count;
  return Math.min(ABSOLUTE_MAX_TILE_WIDTH, Math.max(MIN_TILE_WIDTH, snapDown(raw)));
}

/**
 * Never rejects. A profile with sync storage disabled by policy would otherwise
 * fail the content script's first await and leave the page with no controls at
 * all, when the default width would have served the session perfectly well.
 */
export async function readSettings(): Promise<Settings> {
  try {
    const stored = await browser.storage.sync.get('tileWidth');
    return { tileWidth: clampTileWidth(stored.tileWidth) };
  } catch {
    return { tileWidth: DEFAULT_TILE_WIDTH };
  }
}

export async function writeTileWidth(tileWidth: number): Promise<number> {
  const normalized = clampTileWidth(tileWidth);
  await browser.storage.sync.set({ tileWidth: normalized });
  return normalized;
}
