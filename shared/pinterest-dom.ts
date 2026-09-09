const MORE_CONTROL_SELECTOR = 'button, [role="button"], [aria-label], [data-test-id], [title]';
const CONTROL_ROOT_SELECTOR = 'button, [role="button"], a';
const MORE_IDENTITY = /^(more|more actions?|more options?|overflow|overflow menu|ellipsis|\.{3})$/i;
const MORE_IDENTITY_PART = /\b(more actions?|more options?|overflow menu)\b/i;

const ANY_PIN_SELECTOR = '[data-test-id="pinWrapper"], [data-test-id="gated-pin-rep"]';

export function findGridItem(pin: HTMLElement, root: HTMLElement): HTMLElement {
  let item = pin;
  while (item.parentElement && item.parentElement !== root) {
    const parent = item.parentElement;
    if (parent.querySelectorAll(ANY_PIN_SELECTOR).length !== 1) break;
    item = parent;
  }
  return item;
}

function controlIdentity(control: HTMLElement): string {
  return [
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
    control.getAttribute('data-test-id'),
    control.textContent?.trim(),
  ].filter(Boolean).join(' ').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The first three-dot menu inside `item`, in document order. `isEligible` lets a
 * caller reject a match that belongs to something else on the page: the close-up
 * shares its branch with the grid, whose tiles carry menus of their own.
 */
export function findMoreControl(
  item: HTMLElement,
  isEligible: (control: HTMLElement) => boolean = () => true,
): HTMLElement | null {
  for (const element of item.querySelectorAll<HTMLElement>(MORE_CONTROL_SELECTOR)) {
    const control = element.closest<HTMLElement>(CONTROL_ROOT_SELECTOR) ?? element;
    if (control.closest('[data-ppp-ignore="true"]')) continue;
    const identity = controlIdentity(control);
    if (!MORE_IDENTITY.test(identity) && !MORE_IDENTITY_PART.test(identity)) continue;
    if (!isEligible(control)) continue;
    return control;
  }
  return null;
}

const FAVORITE_STAR_SELECTOR = '[data-test-id="favorite-button-star"]';
const FAVORITE_ROW_SELECTOR = '[data-test-favorited]';

/**
 * The favourite star Pinterest renders in a board pin's footer row. The star is
 * returned as the element that row actually lays out — the wrapper Pinterest
 * stamps `data-test-favorited` on — so a control inserted before it becomes the
 * star's sibling in the footer instead of a sibling of the icon inside it.
 */
export function findFavoriteControl(item: HTMLElement): HTMLElement | null {
  const star = item.querySelector<HTMLElement>(FAVORITE_STAR_SELECTOR);
  if (!star || star.closest('[data-ppp-ignore="true"]')) return null;
  const row = star.closest<HTMLElement>(FAVORITE_ROW_SELECTOR);
  return row && item.contains(row) ? row : star;
}
