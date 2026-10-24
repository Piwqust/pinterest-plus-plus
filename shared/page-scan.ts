import { ANY_PIN_SELECTOR } from './pin-grid-roots';

/** How far one step scrolls, as a share of the window. Overlap keeps pins from being skipped. */
const STEP_SHARE = 0.85;
/** How long a step waits for Pinterest to mount the next pins. */
const SETTLE_MS = 700;
/** Steps in a row that may bring nothing new before the feed counts as finished. */
const MAX_IDLE_STEPS = 4;
/** A hard stop, so a feed that keeps recycling the same pins cannot scan forever. */
const MAX_STEPS = 400;

export interface ScanProgress {
  added: number;
  limit: number;
}

export interface ScanOptions {
  limit: number;
  /**
   * Takes the pins currently mounted, in reading order, and returns how many
   * of them it added. Pinterest unmounts pins scrolled far away, so each step
   * hands over only what is on the page at that moment.
   */
  collect: (pins: HTMLElement[]) => number;
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
  /** Injected by tests; the real one waits for the feed to grow or a timeout. */
  settle?: () => Promise<void>;
}

export interface ScanResult {
  added: number;
  /** Why the scan stopped. */
  reason: 'limit' | 'end' | 'cancelled';
}

function readingOrder(pins: HTMLElement[]): HTMLElement[] {
  const placed = pins.map((pin) => ({ pin, rect: pin.getBoundingClientRect() }));
  placed.sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left));
  return placed.map(({ pin }) => pin);
}

/** Resolves once the page's pins change, or after `SETTLE_MS`, whichever is first. */
function settleFeed(): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0;
    const observer = new MutationObserver(() => {
      // A burst of mutations is one batch of pins; give it a beat to finish.
      window.clearTimeout(timer);
      timer = window.setTimeout(done, 180);
    });
    const done = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(fallback);
      resolve();
    };
    const fallback = window.setTimeout(done, SETTLE_MS);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * Collects pins by scrolling the feed the way a person would, until `limit`
 * have been added, the feed stops growing, or the signal aborts.
 *
 * Scrolling is the only honest way to reach pins further down: Pinterest
 * renders a virtualised list and fetches the next page only when the reader
 * nears the end of the current one.
 */
export async function scanPage(options: ScanOptions): Promise<ScanResult> {
  const settle = options.settle ?? settleFeed;
  let added = 0;
  let idle = 0;
  // Pins already collected still mean the feed is moving; only a step that
  // mounts nothing new counts towards the end.
  const met = new WeakSet<HTMLElement>();
  const report = () => options.onProgress?.({ added: Math.min(added, options.limit), limit: options.limit });

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (options.signal?.aborted) return { added, reason: 'cancelled' };
    const pins = readingOrder(Array.from(document.querySelectorAll<HTMLElement>(ANY_PIN_SELECTOR)));
    const unseen = pins.filter((pin) => !met.has(pin));
    for (const pin of unseen) met.add(pin);
    added += options.collect(pins);
    report();
    if (added >= options.limit) return { added, reason: 'limit' };

    const before = window.scrollY;
    window.scrollBy({ top: Math.round(window.innerHeight * STEP_SHARE), behavior: 'instant' });
    await settle();
    const moved = window.scrollY !== before;
    idle = unseen.length > 0 ? 0 : moved ? idle + 0.5 : idle + 1;
    if (idle >= MAX_IDLE_STEPS) return { added, reason: 'end' };
  }
  return { added, reason: 'end' };
}
