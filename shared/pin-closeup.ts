import { PIN_SELECTOR } from './pin-grid-roots';
import { findMoreControl } from './pinterest-dom';

const CLOSEUP_MEDIA_SELECTOR = 'img, video';
/**
 * Below this edge the element is page chrome — an avatar, a badge, a board
 * thumbnail — rather than the pin being viewed. The closeup renders its media at
 * reading size, so a generous floor still separates it from every icon.
 */
export const MIN_CLOSEUP_MEDIA_EDGE = 160;
/**
 * Pinterest renders the close-up media deep inside its card: the image sits
 * about sixteen wrapper levels below the branch that also holds the action bar.
 * The walk is bounded only so a page without a close-up is not searched to its
 * root.
 */
const MAX_CLOSEUP_DEPTH = 24;
/** Wrappers Pinterest puts between an action-bar item and the button inside it. */
const MAX_ANCHOR_LIFT = 4;
/** A wrapper that only centres or clips its control measures the same as it. */
const ANCHOR_SLACK = 2;
/** Pinterest serves every close-up, page or overlay, at the pin's permalink. */
const CLOSEUP_ROUTE = /^\/pin\//i;
/** Page chrome carries menus of its own, none of them the pin's. */
const PAGE_CHROME_SELECTOR = 'header, nav, [role="banner"], [role="navigation"]';

export interface PinCloseup {
  /** The media the closeup is showing: one image or video, or a carousel's slides. */
  media: Array<HTMLImageElement | HTMLVideoElement>;
  /** The action-bar item holding the closeup's own three-dot menu. */
  anchor: HTMLElement;
}

/** Anything the grid owns, and anything this extension has already added. */
function isForeignBranch(element: Element): boolean {
  return Boolean(element.closest(PIN_SELECTOR) ?? element.closest('[data-ppp-ignore="true"]'));
}

function closeupMediaArea(element: Element): number {
  const rect = element.getBoundingClientRect();
  if (Math.min(rect.width, rect.height) < MIN_CLOSEUP_MEDIA_EDGE) return 0;
  return rect.width * rect.height;
}

/**
 * The largest media the page renders outside the grid. Grid tiles are excluded
 * outright, so a feed rendered around the closeup can never win on size however
 * wide the user has made its tiles.
 */
function findCloseupHero(doc: Document): HTMLImageElement | HTMLVideoElement | null {
  let hero: HTMLImageElement | HTMLVideoElement | null = null;
  let heroArea = 0;
  const media = doc.querySelectorAll<HTMLImageElement | HTMLVideoElement>(CLOSEUP_MEDIA_SELECTOR);
  for (const element of media) {
    if (isForeignBranch(element)) continue;
    const area = closeupMediaArea(element);
    if (area <= heroArea) continue;
    hero = element;
    heroArea = area;
  }
  return hero;
}

/**
 * Media belonging to something other than the pin being viewed: a grid tile, or
 * an element rendered small enough to be an avatar, a favicon or a board cover.
 * A carousel slide Pinterest keeps mounted but unrendered has no box at all, so
 * an unmeasurable element is kept rather than treated as chrome.
 */
function isForeignMedia(element: Element, hero: Element): boolean {
  if (element === hero) return false;
  if (isForeignBranch(element)) return true;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 &&
    Math.min(rect.width, rect.height) < MIN_CLOSEUP_MEDIA_EDGE;
}

/**
 * The widest branch around the hero that still holds nothing but the pin's own
 * media, so a carousel contributes every slide while the card's avatar, its
 * inline previews and the grid around it stay out. The scope is grown from the
 * media rather than taken from wherever the action bar was found, which keeps
 * it tight however far apart Pinterest renders the two.
 */
function findCloseupMediaScope(hero: HTMLElement, doc: Document): HTMLElement {
  let scope: HTMLElement = hero;
  let ancestor = hero.parentElement;
  for (
    let depth = 0;
    depth < MAX_CLOSEUP_DEPTH && ancestor && ancestor !== doc.body;
    depth += 1, ancestor = ancestor.parentElement
  ) {
    if (ancestor.querySelector(PIN_SELECTOR)) break;
    const media = Array.from(ancestor.querySelectorAll(CLOSEUP_MEDIA_SELECTOR));
    if (media.some((element) => isForeignMedia(element, hero))) break;
    scope = ancestor;
  }
  return scope;
}

/**
 * Raises the anchor to the item the action bar itself lays out. Pinterest wraps
 * each icon in containers sized to that icon, so anchoring to the innermost
 * match would insert the actions inside the three-dot button's own box, where
 * the bar has no room for them. A wrapper that only holds the control measures
 * the same as it; the first ancestor that is visibly larger is the bar.
 */
function liftToActionBarItem(control: HTMLElement, doc: Document): HTMLElement {
  let anchor = control;
  for (let depth = 0; depth < MAX_ANCHOR_LIFT; depth += 1) {
    const parent = anchor.parentElement;
    if (!parent || parent === doc.body) break;
    const box = anchor.getBoundingClientRect();
    // Without a box there is no wrapper to recognise, so the match stands.
    if (box.width === 0 || box.height === 0) break;
    const parentBox = parent.getBoundingClientRect();
    if (Math.abs(parentBox.width - box.width) > ANCHOR_SLACK) break;
    if (Math.abs(parentBox.height - box.height) > ANCHOR_SLACK) break;
    anchor = parent;
  }
  return anchor;
}

/**
 * The close-up's own three-dot menu. It is normally found by walking up from the
 * media to the card that holds both, which keeps the match local: Pinterest lays
 * the close-up out inside the same feed as the pins it suggests, so a menu
 * belonging to a grid tile is skipped rather than borrowed, and the walk ends
 * once it has climbed past the card into that grid.
 *
 * Pinterest also has layouts that render the action bar in a separate branch of
 * the page, where no shared ancestor short of the document exists. A walk that
 * finds nothing therefore falls back to the document, in which the only menus
 * outside the grid and the page's own chrome belong to the pin being viewed.
 */
function findCloseupMenu(doc: Document, hero: HTMLElement): HTMLElement | null {
  const outsideGrid = (control: HTMLElement): boolean => !control.closest(PIN_SELECTOR);
  for (
    let depth = 0, ancestor = hero.parentElement;
    depth < MAX_CLOSEUP_DEPTH && ancestor && ancestor !== doc.body;
    depth += 1, ancestor = ancestor.parentElement
  ) {
    const control = findMoreControl(ancestor, outsideGrid);
    if (control) return control;
    if (ancestor.querySelector(PIN_SELECTOR)) break;
  }
  return findMoreControl(
    doc.body,
    (control) => outsideGrid(control) && !control.closest(PAGE_CHROME_SELECTOR),
  );
}

/**
 * Locates the pin close-up: the single pin Pinterest renders at full size with
 * its own action bar. The close-up is not a grid tile, so it carries no
 * `pinWrapper` and the grid's decoration never reaches it.
 *
 * The search is structural rather than class- or id-based. It starts at the
 * page's largest non-grid media, takes the branch that holds the pin's own media
 * as its scope, and anchors the actions to the item the close-up's action bar
 * lays its three-dot menu out in.
 */
export function findPinCloseup(doc: Document): PinCloseup | null {
  if (!CLOSEUP_ROUTE.test(doc.location?.pathname ?? '')) return null;
  const hero = findCloseupHero(doc);
  if (!hero) return null;
  const control = findCloseupMenu(doc, hero);
  if (!control?.parentElement) return null;

  const scope = findCloseupMediaScope(hero, doc);
  const media = scope === hero
    ? [hero]
    : Array.from(scope.querySelectorAll<HTMLImageElement | HTMLVideoElement>(CLOSEUP_MEDIA_SELECTOR));
  return { media, anchor: liftToActionBarItem(control, doc) };
}
