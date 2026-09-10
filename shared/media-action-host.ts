import { ICONS, SHADOW_CSS } from './ui-assets';

export type MediaAction = 'copy' | 'download';

export type ActionScope = 'grid' | 'closeup';
/** The close-up's bar is built from larger controls than a grid tile's. */
const CLOSEUP_HEIGHT = 40;

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
 * by the caller, wearing the same surface as the extension's resize panel — it
 * never borrows Pinterest's chrome, and never sits in a row of theirs. It also
 * starts hidden there, since a tile's controls belong to the hovered tile.
 */
export function createMediaActionHost(
  scope: ActionScope,
  onAction: (action: MediaAction, target: HTMLButtonElement) => Promise<void>,
): HTMLElement {
  const host = document.createElement('span');
  host.dataset.pppIgnore = 'true';
  host.style.cssText = scope === 'closeup'
    ? `display:inline-flex;flex:0 0 auto;align-self:center;align-items:center;height:${CLOSEUP_HEIGHT}px;line-height:0;vertical-align:middle;pointer-events:auto;`
    : 'display:block;line-height:0;pointer-events:auto;';
  if (scope === 'grid') host.dataset.pppHidden = 'true';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  const actions = document.createElement('span');
  actions.className = 'ppp-pin-actions';
  actions.dataset.scope = scope;
  const copyButton = button('ppp-action', 'Copy media', ICONS.copy);
  const downloadButton = button('ppp-action', 'Download media', ICONS.download);
  actions.append(copyButton, downloadButton);
  shadow.append(style, actions);

  host.addEventListener('pointerdown', (event) => event.stopPropagation());
  // A pin is a link, and the click that ran an action must not also open it.
  host.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  copyButton.addEventListener('click', () => void onAction('copy', copyButton));
  downloadButton.addEventListener('click', () => void onAction('download', downloadButton));
  return host;
}

/**
 * Reveals or hides the buttons. Visibility is a property of the host, not of
 * where it sits, so a caller can flip it without knowing what it is laid over.
 */
export function setActionsVisible(host: HTMLElement, visible: boolean): void {
  if (visible) delete host.dataset.pppHidden;
  else host.dataset.pppHidden = 'true';
}
