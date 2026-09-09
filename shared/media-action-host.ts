import { DEFAULT_CHIP_SIZE, type ChipStyle } from './action-chip';
import { ICONS, SHADOW_CSS } from './ui-assets';

export type MediaAction = 'copy' | 'download';

export type ActionScope = 'grid' | 'closeup';
const ACTION_SCOPE_HEIGHT: Record<ActionScope, number> = { grid: 28, closeup: 40 };
const CHIP_PROPERTIES = ['--ppp-chip-bg', '--ppp-chip-radius', '--ppp-chip-size', '--ppp-chip-icon'];
/** Pinterest's overlay icons take a little over half of their chip. */
const CHIP_ICON_RATIO = 0.55;

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
 * Builds the shadow-isolated Copy/Download pair inserted beside a three-dot
 * menu. The close-up sizes its controls to Pinterest's own action bar, which is
 * built from larger buttons than a grid tile's.
 */
export function createMediaActionHost(
  scope: ActionScope,
  onAction: (action: MediaAction, target: HTMLButtonElement) => Promise<void>,
): HTMLElement {
  const host = document.createElement('span');
  host.dataset.pppIgnore = 'true';
  host.style.cssText = `display:inline-flex;flex:0 0 auto;align-self:center;align-items:center;height:${ACTION_SCOPE_HEIGHT[scope]}px;line-height:0;vertical-align:middle;pointer-events:auto;`;
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
  host.addEventListener('click', (event) => event.stopPropagation());
  copyButton.addEventListener('click', () => void onAction('copy', copyButton));
  downloadButton.addEventListener('click', () => void onAction('download', downloadButton));
  return host;
}

/**
 * Dresses the buttons in the chip a neighbouring Pinterest control paints, so
 * they stay readable where the row sits on the pin's own image. Passing `null`
 * returns them to the bare icons a solid footer row calls for.
 */
export function setActionChip(host: HTMLElement, chip: ChipStyle | null): void {
  const actions = host.shadowRoot?.querySelector<HTMLElement>('.ppp-pin-actions');
  if (!actions) return;
  if (!chip) {
    delete actions.dataset.chip;
    for (const property of CHIP_PROPERTIES) host.style.removeProperty(property);
    host.style.height = `${ACTION_SCOPE_HEIGHT[(actions.dataset.scope ?? 'grid') as ActionScope]}px`;
    return;
  }
  actions.dataset.chip = 'true';
  host.style.setProperty('--ppp-chip-bg', chip.background);
  host.style.setProperty('--ppp-chip-radius', chip.radius);
  const size = chip.size ?? DEFAULT_CHIP_SIZE;
  host.style.setProperty('--ppp-chip-size', `${size}px`);
  host.style.setProperty('--ppp-chip-icon', `${Math.round(size * CHIP_ICON_RATIO)}px`);
  // The host reserves the row's height, so it has to grow with the chip.
  host.style.height = `${size}px`;
}
