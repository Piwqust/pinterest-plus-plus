import type { MediaKind } from './messages';
import {
  isAllowedMediaUrl,
  isDownloadableVideoUrl,
  isVideoStreamUrl,
  rankVideoUrl,
  safeFilename,
  toOriginalPinimgUrl,
  type PinMediaOption,
} from './media';

/**
 * Pinterest's own record of a pin, read the way its web client reads it.
 *
 * The rendered page is a poor witness to what a pin holds: a carousel mounts a
 * player only for the slide on screen and draws the rest as stills, and the
 * player streams from a `blob:` URL that names no file. The record lists every
 * slide with the exact files Pinterest encoded for it, so nothing is guessed.
 */

type Json = Record<string, unknown>;

/** Pin ids are numeric; `/pin/create/…` and the like are routes, not pins. */
const PIN_PATH = /\/pin\/(\d+)(?:\/|$)/;
const RESOURCE_PATH = '/resource/PinResource/get/';
const RESOURCE_TIMEOUT_MS = 6_000;
/** Width-only renditions; `236x236` and `600x315` are crops, not the picture. */
const IMAGE_WIDTH_KEY = /^(\d+)x$/i;
const ORIGINAL_IMAGE_KEYS = new Set(['orig', 'originals']);
/** The playlist Pinterest's web player itself picks comes first. */
const STREAM_KEY_ORDER = ['V_HLSV4', 'V_HLSV3_WEB', 'V_HLSV3_MOBILE'];
/** Small enough to be a thumbnail, large enough to stay sharp in the picker. */
const PREVIEW_MIN_WIDTH = 200;
const TITLE_FIELDS = ['title', 'grid_title', 'closeup_unified_title', 'auto_alt_text', 'alt_text', 'description'];
const MAX_CACHED_PINS = 200;

interface Slide {
  kind: MediaKind;
  candidates: string[];
  streams: string[];
  posterCandidates: string[];
  previewUrl: string;
}

const cache = new Map<string, Promise<PinMediaOption[]>>();

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function pinIdFromUrl(value: string): string | null {
  try {
    return new URL(value, location.href).pathname.match(PIN_PATH)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The pin a grid tile links to. Every tile carries a permalink to its pin. */
export function findPinId(scope: ParentNode): string | null {
  for (const link of scope.querySelectorAll<HTMLAnchorElement>('a[href*="/pin/"]')) {
    const id = pinIdFromUrl(link.getAttribute('href') ?? '');
    if (id) return id;
  }
  return null;
}

interface ImageRendition {
  url: string;
  width: number;
}

function imageRenditions(images: Json | null): { originals: string[]; sized: ImageRendition[] } {
  const originals: string[] = [];
  const sized: ImageRendition[] = [];
  for (const [key, value] of Object.entries(images ?? {})) {
    const url = text(record(value)?.url);
    if (!url || !isAllowedMediaUrl(url)) continue;
    if (ORIGINAL_IMAGE_KEYS.has(key)) {
      originals.push(url);
      continue;
    }
    const width = Number(key.match(IMAGE_WIDTH_KEY)?.[1]);
    if (width) sized.push({ url, width });
  }
  sized.sort((a, b) => b.width - a.width);
  return { originals, sized };
}

function imageSources(images: Json | null): { candidates: string[]; previewUrl: string } {
  const { originals, sized } = imageRenditions(images);
  const candidates = unique([
    ...originals,
    ...sized.map(({ url }) => toOriginalPinimgUrl(url) ?? ''),
    ...sized.map(({ url }) => url),
  ]);
  const preview = [...sized].reverse().find(({ width }) => width >= PREVIEW_MIN_WIDTH)?.url ??
    sized[0]?.url ?? candidates[0] ?? '';
  return { candidates, previewUrl: preview };
}

function videoSources(videoList: Json | null): { candidates: string[]; streams: string[]; posters: string[] } | null {
  const entries = Object.entries(videoList ?? {}).map(([key, value]) => ({
    key,
    url: text(record(value)?.url),
    thumbnail: text(record(value)?.thumbnail),
  }));
  const candidates = unique(entries.map(({ url }) => url).filter(isDownloadableVideoUrl))
    .sort((a, b) => rankVideoUrl(b) - rankVideoUrl(a));
  const keyRank = (key: string) => {
    const index = STREAM_KEY_ORDER.indexOf(key);
    return index === -1 ? STREAM_KEY_ORDER.length : index;
  };
  const streams = unique(entries
    .filter(({ url }) => isVideoStreamUrl(url))
    .sort((a, b) => keyRank(a.key) - keyRank(b.key))
    .map(({ url }) => url));
  if (candidates.length === 0 && streams.length === 0) return null;
  const posters = unique(entries.map(({ thumbnail }) => thumbnail).filter(isAllowedMediaUrl));
  return { candidates, streams, posters };
}

/**
 * One slide of a pin. Pinterest describes a video slide with its cover image
 * beside it, so a slide is a video whenever it lists a video at all.
 */
function slideFrom(container: Json | null): Slide | null {
  if (!container) return null;
  const videoList = record(record(container.videos)?.video_list) ?? record(record(container.video)?.video_list);
  const images = record(container.images) ?? record(record(container.image)?.images);
  const image = imageSources(images);
  const video = videoSources(videoList);
  if (video) {
    return {
      kind: 'video',
      candidates: video.candidates,
      streams: video.streams,
      posterCandidates: unique([...video.posters, ...image.candidates]),
      previewUrl: image.previewUrl || video.posters[0] || '',
    };
  }
  if (image.candidates.length === 0) return null;
  return { kind: 'image', candidates: image.candidates, streams: [], posterCandidates: [], previewUrl: image.previewUrl };
}

function slidesFrom(pin: Json): Slide[] {
  const present = (slide: Slide | null): slide is Slide => Boolean(slide);
  const carousel = list(record(pin.carousel_data)?.carousel_slots).map(record).map(slideFrom).filter(present);
  if (carousel.length > 0) return carousel;

  // Idea Pins put each page's media in blocks; text blocks carry none.
  const story = list(record(pin.story_pin_data)?.pages)
    .flatMap((page) => list(record(page)?.blocks))
    .map(record)
    .map(slideFrom)
    .filter(present);
  if (story.length > 0) return story;

  const single = slideFrom(pin);
  return single ? [single] : [];
}

/** A description can run to paragraphs; its first sentence is enough to name a file. */
function headline(value: string): string {
  const line = value.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? '';
  return line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line;
}

function pinTitle(pin: Json): string {
  for (const field of TITLE_FIELDS) {
    const value = headline(text(pin[field]));
    if (value) return value;
  }
  return '';
}

/** Every slide of a pin record, in Pinterest's order, ready for the picker. */
export function pinMediaFromData(data: unknown): PinMediaOption[] {
  const pin = record(data);
  if (!pin) return [];
  const slides = slidesFrom(pin);
  const title = pinTitle(pin);
  return slides.map((slide, index) => ({
    kind: slide.kind,
    candidates: slide.candidates,
    streams: slide.streams,
    posterCandidates: slide.posterCandidates,
    previewUrl: slide.previewUrl,
    suggestedName: safeFilename(
      slide.candidates[0] ?? slide.posterCandidates[0] ?? slide.streams[0] ?? '',
      slide.kind,
      title,
      slides.length > 1 ? index + 1 : undefined,
    ),
  }));
}

/**
 * Asks Pinterest for the pin the way its web client does. The request is
 * same-origin and carries the user's session, so a secret board's pin resolves
 * for the person allowed to see it.
 */
export async function fetchPinData(pinId: string): Promise<unknown> {
  const url = new URL(RESOURCE_PATH, location.origin);
  url.searchParams.set('source_url', `/pin/${pinId}/`);
  url.searchParams.set('data', JSON.stringify({ options: { id: pinId, field_set_key: 'detailed' }, context: {} }));

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), RESOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(url.href, {
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        // Pinterest refuses resource reads that do not name the page handling them.
        'X-Pinterest-PWS-Handler': 'www/pin/[id].js',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Pin request failed with ${response.status}`);
    const body: unknown = await response.json();
    return record(record(body)?.resource_response)?.data;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * The pin's slides from its record, or an empty list when Pinterest would not
 * say, in which case the caller falls back to what the page rendered.
 */
export async function resolvePinMedia(pinId: string | null): Promise<PinMediaOption[]> {
  if (!pinId) return [];
  let pending = cache.get(pinId);
  if (!pending) {
    pending = fetchPinData(pinId).then(pinMediaFromData);
    cache.set(pinId, pending);
    if (cache.size > MAX_CACHED_PINS) cache.delete(cache.keys().next().value!);
  }
  try {
    const media = await pending;
    if (media.length === 0) cache.delete(pinId);
    return media;
  } catch {
    cache.delete(pinId);
    return [];
  }
}
