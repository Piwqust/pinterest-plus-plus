import type { MediaKind } from './messages';
import { filenameStem, mediaFileExtension } from './media';

/**
 * The collection: pins gathered from Pinterest's grids into the extension's
 * own panel, where they can be filtered, sorted into folders and saved in one
 * go. Everything here is pure, so the panel, the store and the tests share it.
 */

export type Shape = 'portrait' | 'square' | 'landscape';
export const SHAPES: readonly Shape[] = ['portrait', 'square', 'landscape'];

export type Hue = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'mono';
export const HUES: readonly Hue[] = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'mono'];
/** What each swatch in the colour filter is painted with. */
export const HUE_SWATCH: Record<Hue, string> = {
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#ffc53d',
  green: '#46a758',
  teal: '#12a594',
  blue: '#3e63dd',
  purple: '#8e4ec6',
  pink: '#d6409f',
  mono: 'linear-gradient(135deg, #f4f4f6 0 50%, #18181b 50% 100%)',
};

export interface HueShare {
  hue: Hue;
  /** Of the picture's counted pixels, 0–1. */
  share: number;
}

export interface CollectedPin {
  /** The pin id, or the media's own address when the tile names no pin. */
  key: string;
  pinId: string | null;
  title: string;
  kind: MediaKind;
  previewUrl: string;
  candidates: string[];
  streams: string[];
  posterCandidates: string[];
  /** Width over height as Pinterest laid it out; 0 when it could not be measured. */
  ratio: number;
  /** `null` until the preview has been measured. */
  palette: HueShare[] | null;
  folderId: string | null;
  addedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface CollectionState {
  pins: CollectedPin[];
  folders: Folder[];
}

export type KindFilter = 'all' | MediaKind;
/** `all`, `unfiled`, or a folder id. */
export type FolderView = string;
export const ALL_VIEW: FolderView = 'all';
export const UNFILED_VIEW: FolderView = 'unfiled';

export interface CollectionFilters {
  kind: KindFilter;
  shapes: Shape[];
  hues: Hue[];
}

export const EMPTY_FILTERS: CollectionFilters = { kind: 'all', shapes: [], hues: [] };

/** Storage holds a few megabytes; this keeps the collection well inside it. */
export const MAX_COLLECTED_PINS = 2000;
export const MAX_FOLDERS = 40;
export const MAX_FOLDER_NAME = 40;
/** Sources kept per pin. The first few are the only ones ever reached. */
const MAX_SOURCES = 4;
/** A hue has to cover this much of a picture before the picture counts as that colour. */
export const HUE_MATCH_SHARE = 0.14;
const PALETTE_MIN_SHARE = 0.06;
const PALETTE_SIZE = 4;
/** A square crop drawn a pixel off is still square. */
const SQUARE_TOLERANCE = 0.1;

export function shapeOf(ratio: number): Shape | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  if (ratio < 1 - SQUARE_TOLERANCE) return 'portrait';
  if (ratio > 1 + SQUARE_TOLERANCE) return 'landscape';
  return 'square';
}

export function pinKey(pinId: string | null, sources: readonly string[]): string | null {
  if (pinId) return pinId;
  const source = sources.find(Boolean);
  return source ? `m:${source}` : null;
}

function hueOf(red: number, green: number, blue: number): { hue: number; saturation: number; lightness: number } {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, saturation, lightness };
}

/** Bands are drawn wider where the eye names fewer colours (greens, blues). */
function bandOf(hue: number): Hue {
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 40) return 'orange';
  if (hue < 68) return 'yellow';
  if (hue < 160) return 'green';
  if (hue < 195) return 'teal';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  return 'pink';
}

/**
 * The colours a picture is made of, largest first, from its RGBA pixels.
 *
 * A picture is rarely one colour, so the filter matches on every colour that
 * covers a fair share of it rather than on a single average, which for a red
 * and blue poster would come out a muddy purple neither of them is. Washed-out,
 * near-black and near-white pixels count as `mono`, at a lower weight, so a
 * product shot on white still reads as the product's colour.
 */
export function paletteFromPixels(pixels: ArrayLike<number>): HueShare[] {
  const weights = new Map<Hue, number>();
  let total = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < 128) continue;
    const { hue, saturation, lightness } = hueOf(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0);
    const neutral = saturation < 0.2 || lightness < 0.12 || lightness > 0.93;
    const band: Hue = neutral ? 'mono' : bandOf(hue);
    const weight = neutral ? 0.6 : 1;
    weights.set(band, (weights.get(band) ?? 0) + weight);
    total += weight;
  }
  if (total === 0) return [];
  return [...weights.entries()]
    .map(([hue, weight]) => ({ hue, share: Math.round((weight / total) * 100) / 100 }))
    .filter(({ share }) => share >= PALETTE_MIN_SHARE)
    .sort((a, b) => b.share - a.share)
    .slice(0, PALETTE_SIZE);
}

function inView(pin: CollectedPin, view: FolderView): boolean {
  if (view === ALL_VIEW) return true;
  if (view === UNFILED_VIEW) return pin.folderId === null;
  return pin.folderId === view;
}

export function matchesFilters(pin: CollectedPin, filters: CollectionFilters): boolean {
  if (filters.kind !== 'all' && pin.kind !== filters.kind) return false;
  if (filters.shapes.length > 0) {
    const shape = shapeOf(pin.ratio);
    if (!shape || !filters.shapes.includes(shape)) return false;
  }
  if (filters.hues.length > 0) {
    // An unmeasured picture has no colour yet; it appears once it is measured.
    if (!pin.palette) return false;
    if (!pin.palette.some(({ hue, share }) => share >= HUE_MATCH_SHARE && filters.hues.includes(hue))) return false;
  }
  return true;
}

export function isFiltering(filters: CollectionFilters): boolean {
  return filters.kind !== 'all' || filters.shapes.length > 0 || filters.hues.length > 0;
}

export interface VisiblePins {
  /** Every pin in the folder, before filters. */
  inFolder: CollectedPin[];
  shown: CollectedPin[];
}

/** Newest first, the way a feed reads. */
export function visiblePins(state: CollectionState, view: FolderView, filters: CollectionFilters): VisiblePins {
  const inFolder = state.pins.filter((pin) => inView(pin, view)).sort((a, b) => b.addedAt - a.addedAt);
  return { inFolder, shown: inFolder.filter((pin) => matchesFilters(pin, filters)) };
}

export function folderCounts(state: CollectionState): Map<FolderView, number> {
  const counts = new Map<FolderView, number>([[ALL_VIEW, state.pins.length], [UNFILED_VIEW, 0]]);
  for (const folder of state.folders) counts.set(folder.id, 0);
  for (const pin of state.pins) {
    const view = pin.folderId ?? UNFILED_VIEW;
    counts.set(view, (counts.get(view) ?? 0) + 1);
  }
  return counts;
}

export function cleanFolderName(value: string): string {
  return value.replace(/[\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown, limit = MAX_SOURCES): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.startsWith('https://')).slice(0, limit)
    : [];
}

function palette(value: unknown): HueShare[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    const entry = record(item);
    const hue = entry?.hue;
    const share = Number(entry?.share);
    return typeof hue === 'string' && (HUES as readonly string[]).includes(hue) && share > 0 && share <= 1
      ? [{ hue: hue as Hue, share }]
      : [];
  }).slice(0, PALETTE_SIZE);
}

/** Trims a freshly captured pin to what is worth keeping in storage. */
export function compactPin(pin: CollectedPin): CollectedPin {
  return {
    ...pin,
    title: pin.title.slice(0, 200),
    candidates: pin.candidates.slice(0, MAX_SOURCES),
    streams: pin.streams.slice(0, MAX_SOURCES),
    posterCandidates: pin.posterCandidates.slice(0, MAX_SOURCES),
  };
}

/**
 * Reads whatever storage holds back into a collection. A value written by an
 * older or newer build, or damaged by hand, loses the parts that do not fit
 * rather than the whole collection.
 */
export function normalizeCollection(value: unknown): CollectionState {
  const raw = record(value);
  const folders: Folder[] = [];
  const folderIds = new Set<string>();
  for (const item of Array.isArray(raw?.folders) ? raw.folders : []) {
    const entry = record(item);
    const id = typeof entry?.id === 'string' ? entry.id : '';
    const name = cleanFolderName(typeof entry?.name === 'string' ? entry.name : '');
    if (!id || !name || folderIds.has(id) || folders.length >= MAX_FOLDERS) continue;
    folderIds.add(id);
    folders.push({ id, name, createdAt: Number(entry?.createdAt) || 0 });
  }

  const pins: CollectedPin[] = [];
  const keys = new Set<string>();
  for (const item of Array.isArray(raw?.pins) ? raw.pins : []) {
    const entry = record(item);
    const key = typeof entry?.key === 'string' ? entry.key : '';
    const kind: MediaKind = entry?.kind === 'video' ? 'video' : 'image';
    const candidates = strings(entry?.candidates);
    const streams = strings(entry?.streams);
    const posterCandidates = strings(entry?.posterCandidates);
    if (!key || keys.has(key) || pins.length >= MAX_COLLECTED_PINS) continue;
    if (candidates.length === 0 && streams.length === 0 && posterCandidates.length === 0) continue;
    const folderId = typeof entry?.folderId === 'string' && folderIds.has(entry.folderId) ? entry.folderId : null;
    keys.add(key);
    pins.push({
      key,
      pinId: typeof entry?.pinId === 'string' && /^\d+$/.test(entry.pinId) ? entry.pinId : null,
      title: typeof entry?.title === 'string' ? entry.title.slice(0, 200) : '',
      kind,
      previewUrl: strings([entry?.previewUrl], 1)[0] ?? candidates.at(-1) ?? posterCandidates[0] ?? '',
      candidates,
      streams,
      posterCandidates,
      ratio: Number(entry?.ratio) > 0 ? Number(entry?.ratio) : 0,
      palette: palette(entry?.palette),
      folderId,
      addedAt: Number(entry?.addedAt) || 0,
    });
  }
  return { pins, folders };
}

export function pinUrl(pin: CollectedPin): string {
  return pin.pinId ? `https://www.pinterest.com/pin/${pin.pinId}/` : '';
}

/** A folder or archive name that every filesystem accepts. */
export function directoryName(name: string, fallback: string): string {
  return filenameStem(name) || fallback;
}

/**
 * The path a pin is saved under inside a folder, without its extension: that
 * depends on which of its sources Pinterest actually serves. Names repeat
 * across a board ("Untitled", the same product twice), so `used` makes each
 * one unique within the batch.
 */
export function exportStem(pin: CollectedPin, used: Set<string>): string {
  const source = pin.candidates[0] ?? pin.posterCandidates[0] ?? pin.streams[0] ?? '';
  const base = filenameStem(pin.title) || (pin.pinId ? `pin-${pin.pinId}` : `${pin.kind}-${hashCode(source)}`);
  let stem = base;
  for (let index = 2; used.has(stem.toLowerCase()); index += 1) stem = `${base}-${index}`;
  used.add(stem.toLowerCase());
  return stem;
}

/** The extension a file saved from `source` gets. */
export function exportExtension(source: string, kind: MediaKind): string {
  return mediaFileExtension(source, kind);
}

function hashCode(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

export interface CreditRow {
  file: string;
  title: string;
  pinUrl: string;
}

function csvCell(value: string): string {
  // A leading = + - @ would be run as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Where every saved picture came from, so the people who made them can be credited. */
export function creditsCsv(rows: readonly CreditRow[]): string {
  const lines = [['file', 'title', 'pin'], ...rows.map((row) => [row.file, row.title, row.pinUrl])]
    .map((cells) => cells.map(csvCell).join(','));
  // The byte-order mark makes Excel read the titles as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`;
}
