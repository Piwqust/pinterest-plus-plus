/**
 * A pin without a title has no footer row, so Pinterest lays its controls
 * straight onto the image and gives each one an opaque chip to stay readable.
 * Bare icons inserted into that row disappear into the photo, so the chip a
 * neighbouring control paints is measured and mirrored instead of guessed.
 */
export interface ChipStyle {
  background: string;
  radius: string;
  /** Edge of the neighbour's chip in px, when it was measurable. */
  size?: number;
}

/** Matches the `--ppp-chip-size` fallback in the shadow stylesheet. */
export const DEFAULT_CHIP_SIZE = 32;
/** Used where nothing next to the buttons paints a chip of its own. */
export const DEFAULT_CHIP: ChipStyle = { background: '#ffffff', radius: '50%' };

const MEDIA_SELECTOR = 'img, video';
/** A control is a handful of nodes deep; scanning further only costs time. */
const MAX_CHIP_PROBES = 12;
const MIN_CHIP_ALPHA = 0.08;
/** A control's row is a few nodes above it; the card itself is not the row. */
const MAX_SURFACE_DEPTH = 4;
const MIN_CHIP_SIZE = 20;
const MAX_CHIP_SIZE = 56;

/** The element's own background colour, when it is opaque enough to see. */
function paintedBackground(element: Element): string | null {
  const color = getComputedStyle(element).backgroundColor;
  const match = /^rgba?\(([^)]+)\)$/.exec(color);
  if (!match) return null;
  const parts = match[1]!.split(',');
  const alpha = parts.length > 3 ? Number.parseFloat(parts[3]!) : 1;
  if (!Number.isFinite(alpha) || alpha < MIN_CHIP_ALPHA) return null;
  return color;
}

/** Whether the element covers what is behind it at all, gradients included. */
function paintsSurface(element: Element): boolean {
  const image = getComputedStyle(element).backgroundImage;
  return paintedBackground(element) !== null || (image !== '' && image !== 'none');
}

/**
 * The chip a Pinterest control paints, if it paints one. The outermost painted
 * node wins: a control's own element usually stays transparent and hands the
 * surface to the wrapper the icon sits in.
 */
export function readChipStyle(control: HTMLElement): ChipStyle | null {
  const probes = [control, ...control.querySelectorAll<HTMLElement>('*')].slice(0, MAX_CHIP_PROBES);
  for (const probe of probes) {
    const background = paintedBackground(probe);
    if (!background) continue;
    const rect = probe.getBoundingClientRect();
    const edge = Math.round(Math.max(rect.width, rect.height));
    const chip: ChipStyle = { background, radius: getComputedStyle(probe).borderRadius || '50%' };
    if (edge >= MIN_CHIP_SIZE && edge <= MAX_CHIP_SIZE) chip.size = edge;
    return chip;
  }
  return null;
}

/**
 * Whether the row holding `element` already paints a surface under the buttons
 * — a footer strip, or a bar Pinterest draws behind a whole overlay. On such a
 * surface the neighbours stay bare, so ours must stay bare too.
 *
 * The walk stops at the card: a pin's own wrapper and everything above it paint
 * the page, not the row, and a footer row sits beside that wrapper rather than
 * inside it.
 */
export function hasSurfaceBelow(element: HTMLElement, pin: HTMLElement): boolean {
  let node = element.parentElement;
  for (let depth = 0; depth < MAX_SURFACE_DEPTH && node; depth += 1, node = node.parentElement) {
    if (node === pin || node.contains(pin)) break;
    if (paintsSurface(node)) return true;
  }
  return false;
}

/** Whether `element`'s centre sits on top of one of the pin's own media boxes. */
export function isOverMedia(element: HTMLElement, pin: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  for (const media of pin.querySelectorAll<HTMLElement>(MEDIA_SELECTOR)) {
    const box = media.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true;
  }
  return false;
}

/**
 * The chip our buttons should wear beside `anchor` inside `pin`. `anchor` is
 * null where the buttons are overlaid on the image with no neighbour at all,
 * which is exactly the case that needs a chip most.
 */
export function chipFor(pin: HTMLElement, anchor: HTMLElement | null): ChipStyle | null {
  if (!anchor) return DEFAULT_CHIP;
  if (hasSurfaceBelow(anchor, pin)) return null;
  return readChipStyle(anchor) ?? (isOverMedia(anchor, pin) ? DEFAULT_CHIP : null);
}
