import { ICONS, SHADOW_CSS } from './ui-assets';

export type MediaAction = 'copy' | 'download';
/** Everything a host's buttons can ask for: the two media actions, and adding the pin to the collection. */
export type HostAction = MediaAction | 'collect';

export type ActionScope = 'grid' | 'closeup' | 'row';
/** The close-up's bar is built from larger controls than a grid tile's. */
const CLOSEUP_HEIGHT = 40;
/** A card footer's three-dot menu, in CSS pixels, when it cannot be measured. */
export const DEFAULT_ROW_SIZE = 24;

export function button(className: string, label: string, icon: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.className = className;
  element.type = 'button';
  element.setAttribute('aria-label', label);
  element.title = label;
  element.innerHTML = `${icon}<span>${label}</span>`;
  return element;
}

/**
 * Builds the shadow-isolated Copy/Download pair.
 *
 * In the close-up the pair joins Pinterest's own action bar and sizes itself to
 * match. On the grid it is a small panel of its own, laid over the pin's media
 * by the caller, wearing the same surface as the extension's resize panel, and
 * starts hidden, since a tile's controls belong to the hovered tile. In a card
 * footer (`row`) it sits beside the three-dot menu at that menu's size, which
 * the caller passes in because Pinterest scales whole cards with a transform.
 */
export function createMediaActionHost(
  scope: ActionScope,
  onAction: (action: HostAction, target: HTMLButtonElement) => Promise<void>,
  rowSize = DEFAULT_ROW_SIZE,
): HTMLElement {
  const host = document.createElement('span');
  host.dataset.pppIgnore = 'true';
  host.style.cssText = scope === 'closeup'
    ? `display:inline-flex;flex:0 0 auto;align-self:center;align-items:center;height:${CLOSEUP_HEIGHT}px;line-height:0;vertical-align:middle;pointer-events:auto;`
    : scope === 'row'
      // Never taller than the menu beside it: a footer row stretches to its
      // tallest child, and a taller one would push into the card below.
      ? `display:inline-flex;flex:0 0 auto;align-self:center;align-items:center;height:${rowSize}px;line-height:0;pointer-events:auto;--ppp-row-size:${rowSize}px;`
      : 'display:block;line-height:0;';
  if (scope === 'grid') setActionsVisible(host, false);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  const actions = document.createElement('span');
  actions.className = 'ppp-pin-actions';
  actions.dataset.scope = scope;
  const copyButton = button('ppp-action', 'Copy media', ICONS.copy);
  const downloadButton = button('ppp-action', 'Download media', ICONS.download);
  const collectButton = button('ppp-action', 'Add to collection', ICONS.collect);
  collectButton.dataset.action = 'collect';
  actions.append(copyButton, downloadButton, collectButton);
  shadow.append(style, actions);

  host.addEventListener('pointerdown', (event) => event.stopPropagation());
  // A mouse press must not move focus. Pinterest lays a feed card out afresh
  // when focus enters it, at its true width instead of the scaled one it is
  // drawn at, so a button inside the card moved out from under the pointer
  // between press and release, and the click landed on whatever took its
  // place. Keyboard focus is untouched: Tab still reaches the buttons.
  host.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  // A pin is a link, and the click that ran an action must not also open it.
  host.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  copyButton.addEventListener('click', () => void onAction('copy', copyButton));
  downloadButton.addEventListener('click', () => void onAction('download', downloadButton));
  collectButton.addEventListener('click', () => void onAction('collect', collectButton));
  return host;
}

/**
 * Shows whether the pin a host serves is in the collection. The grid's single
 * panel moves between pins, so its owner calls this each time it does.
 */
export function setCollected(host: HTMLElement, collected: boolean): void {
  const target = host.shadowRoot?.querySelector<HTMLButtonElement>('[data-action="collect"]');
  if (!target || target.dataset.collected === String(collected)) return;
  const label = collected ? 'Remove from collection' : 'Add to collection';
  target.dataset.collected = String(collected);
  target.setAttribute('aria-label', label);
  target.setAttribute('aria-pressed', String(collected));
  target.title = label;
  target.innerHTML = `${collected ? ICONS.collected : ICONS.collect}<span>${label}</span>`;
}

/**
 * Reveals or hides the buttons. Visibility is a property of the host, not of
 * where it sits, so a caller can flip it without knowing what it is laid over.
 *
 * A hidden host keeps its box wherever it was last placed — before the first
 * hover that is the viewport's top-left corner, over Pinterest's logo — so it
 * must stop taking hits too, or it swallows clicks meant for the page beneath.
 */
export function setActionsVisible(host: HTMLElement, visible: boolean): void {
  if (visible) delete host.dataset.pppHidden;
  else host.dataset.pppHidden = 'true';
  host.style.pointerEvents = visible ? 'auto' : 'none';
}
