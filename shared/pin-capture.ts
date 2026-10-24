import { paletteFromPixels, pinKey, type CollectedPin, type HueShare } from './collection';
import type { CollectionStore } from './collection-store';
import { collectMediaOptions } from './media';
import { findPinCloseup } from './pin-closeup';
import { findPinId, pinIdFromUrl } from './pin-data';
import { ANY_PIN_SELECTOR } from './pin-grid-roots';

/** Every card Pinterest's masonry lays out carries this. */
const GRID_ITEM_SELECTOR = '[data-grid-item]';
const PROMOTED_TEST_ID = '[data-test-id*="promoted" i], [data-test-id*="sponsor" i]';
/** "Promoted by …", "Sponsored": the label Pinterest prints under an ad. */
const PROMOTED_LABEL = /^(?:promoted|sponsored)\b/i;
/** A card's own text is a few dozen leaves; past that it is not a card. */
const MAX_LABEL_LEAVES = 120;
/** Pinterest's generated alt text opens with this before saying what is pictured. */
const ALT_PREAMBLE = /^this (?:pin )?(?:contains|may contain)[^:]*:\s*/i;
/** Large enough to tell colours apart, small enough to read in a millisecond. */
const PALETTE_EDGE = 24;
const PALETTE_TIMEOUT_MS = 8_000;
const PALETTE_CONCURRENCY = 3;

/** The card around a pin: its footer, where Pinterest labels an ad, sits outside the pin. */
function cardOf(pin: HTMLElement): HTMLElement {
  return pin.closest<HTMLElement>(GRID_ITEM_SELECTOR) ?? pin;
}

/**
 * Whether a grid pin is an ad. Pinterest marks them in words rather than in
 * markup it keeps stable, so the card's short text leaves are read for the
 * label, alongside any test id that names it.
 */
export function isPromotedPin(pin: HTMLElement): boolean {
  const card = cardOf(pin);
  if (card.matches(PROMOTED_TEST_ID) || card.querySelector(PROMOTED_TEST_ID)) return true;
  let leaves = 0;
  for (const element of card.querySelectorAll<HTMLElement>('div, span, a, p')) {
    if (element.childElementCount > 0) continue;
    const text = element.textContent?.trim() ?? '';
    if (!text || text.length > 40) continue;
    if (PROMOTED_LABEL.test(text)) return true;
    leaves += 1;
    if (leaves >= MAX_LABEL_LEAVES) break;
  }
  return false;
}

function area(element: Element): number {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
}

/**
 * The pin's own picture or video. A card also renders the creator's avatar
 * and, for a video, a poster under the player, so the largest element wins and
 * a player beats a still the same size.
 */
function mainMedia(scope: ParentNode): HTMLImageElement | HTMLVideoElement | null {
  const media = Array.from(scope.querySelectorAll<HTMLImageElement | HTMLVideoElement>('video, img'));
  let best: HTMLImageElement | HTMLVideoElement | null = null;
  let bestArea = -1;
  for (const element of media) {
    const size = area(element) * (element instanceof HTMLVideoElement ? 1.01 : 1);
    if (size > bestArea) {
      best = element;
      bestArea = size;
    }
  }
  return best;
}

function ratioOf(element: HTMLImageElement | HTMLVideoElement): number {
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return Math.round((rect.width / rect.height) * 1000) / 1000;
  const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
  const height = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
  return width > 0 && height > 0 ? Math.round((width / height) * 1000) / 1000 : 0;
}

function titleOf(element: HTMLImageElement | HTMLVideoElement, scope: HTMLElement): string {
  const link = element.closest('a') ?? scope.querySelector('a[href*="/pin/"]');
  const values = [
    element instanceof HTMLImageElement ? element.alt : '',
    element.getAttribute('aria-label') ?? '',
    link?.getAttribute('aria-label') ?? '',
  ];
  return values.map((value) => value.replace(ALT_PREAMBLE, '').trim()).find(Boolean) ?? '';
}

function captureFrom(
  element: HTMLImageElement | HTMLVideoElement,
  scope: HTMLElement,
  pinId: string | null,
  now: number,
): CollectedPin | null {
  const media = collectMediaOptions([element])[0];
  if (!media) return null;
  const key = pinKey(pinId, [...media.candidates, ...media.posterCandidates, ...media.streams]);
  if (!key) return null;
  return {
    key,
    pinId,
    title: titleOf(element, scope),
    kind: media.kind,
    previewUrl: media.previewUrl,
    candidates: media.candidates,
    streams: media.streams,
    posterCandidates: media.posterCandidates,
    ratio: ratioOf(element),
    palette: null,
    folderId: null,
    addedAt: now,
  };
}

/** A grid pin as the collection keeps it, read from what the tile renders. */
export function capturePin(pin: HTMLElement, now = Date.now()): CollectedPin | null {
  const element = mainMedia(pin);
  return element ? captureFrom(element, pin, findPinId(pin), now) : null;
}

/** The pin being viewed in the close-up, or the slide of it on screen. */
export function captureCloseup(doc: Document = document, now = Date.now()): CollectedPin | null {
  const closeup = findPinCloseup(doc);
  if (!closeup) return null;
  const element = closeup.media.reduce<HTMLImageElement | HTMLVideoElement | null>(
    (best, media) => (!best || area(media) > area(best) ? media : best),
    null,
  );
  const scope = closeup.anchor.parentElement ?? doc.body;
  return element ? captureFrom(element, scope, pinIdFromUrl(doc.location.href), now) : null;
}

/** The pin a grid element belongs to, if any. */
export function pinOf(target: Element): HTMLElement | null {
  return target.closest<HTMLElement>(ANY_PIN_SELECTOR);
}

/**
 * Reads the colours of a preview. The tile's own `<img>` was loaded without
 * CORS and would taint a canvas, so the thumbnail is fetched again; Pinimg
 * serves it to any origin and it is already in the HTTP cache.
 */
export async function measurePalette(url: string): Promise<HueShare[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PALETTE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'omit', cache: 'force-cache', signal: controller.signal });
    if (!response.ok) return [];
    const bitmap = await createImageBitmap(await response.blob(), {
      resizeWidth: PALETTE_EDGE,
      resizeHeight: PALETTE_EDGE,
      resizeQuality: 'low',
    });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = PALETTE_EDGE;
      canvas.height = PALETTE_EDGE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return [];
      context.drawImage(bitmap, 0, 0);
      return paletteFromPixels(context.getImageData(0, 0, PALETTE_EDGE, PALETTE_EDGE).data);
    } finally {
      bitmap.close();
    }
  } catch {
    return [];
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Measures the colours of collected pins a few at a time. A pin that cannot be
 * measured is stored with an empty palette, so it is not fetched again on
 * every visit.
 */
export class PaletteQueue {
  private queued = new Set<string>();
  private running = 0;
  private stopped = false;

  constructor(private store: CollectionStore, private measure: (url: string) => Promise<HueShare[]> = measurePalette) {}

  /** Queues every pin that has no palette yet. */
  fill(): void {
    for (const pin of this.store.snapshot.pins) {
      if (pin.palette === null && pin.previewUrl) this.queued.add(pin.key);
    }
    this.pump();
  }

  stop(): void {
    this.stopped = true;
    this.queued.clear();
  }

  private pump(): void {
    while (!this.stopped && this.running < PALETTE_CONCURRENCY && this.queued.size > 0) {
      const key = this.queued.values().next().value!;
      this.queued.delete(key);
      const pin = this.store.snapshot.pins.find((candidate) => candidate.key === key);
      if (!pin || pin.palette !== null || !pin.previewUrl) continue;
      this.running += 1;
      void this.measure(pin.previewUrl)
        .catch(() => [])
        .then((palette) => {
          if (!this.stopped) this.store.setPalette(key, palette);
        })
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }
}
