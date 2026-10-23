import { GridResizer } from '../shared/grid-resizer';
import {
  GRID_STATUS_EVENT,
  isGridStatusDetail,
} from '../shared/grid-bridge-events';
import { GridUi, VIEWPORT_WIDTH_RESERVE } from '../shared/grid-ui';
import { createMediaActionHost } from '../shared/media-action-host';
import { PinActionManager } from '../shared/pin-action-manager';
import { CloseupActionManager } from '../shared/closeup-action-manager';
import { RowActionManager } from '../shared/row-action-manager';
import {
  clampTileWidth,
  maxTileWidthFor,
  normalizeButtonPlacement,
  readSettings,
  type ButtonPlacement,
} from '../shared/settings';
import { SHADOW_CSS } from '../shared/ui-assets';

/**
 * Runs once React has hydrated the server-rendered feed. A node of ours inside
 * a card it is still hydrating would fail hydration and get the card rebuilt,
 * so the footer buttons wait for the page to load and go idle first.
 */
function afterHydration(run: () => void): () => void {
  let cancelled = false;
  const go = () => {
    if (!cancelled) run();
  };
  const idle = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 2_000 });
    else window.setTimeout(go, 0);
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
  return () => {
    cancelled = true;
  };
}

export default defineContentScript({
  matches: ['https://*.pinterest.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const host = document.createElement('div');
    host.id = 'pinterest-plus-plus-root';
    host.dataset.pppIgnore = 'true';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowStyle = document.createElement('style');
    shadowStyle.textContent = SHADOW_CSS;
    shadow.append(shadowStyle);
    document.documentElement.append(host);

    const settings = await readSettings();
    // The stored width is the user's preference; the grid starts at whatever
    // this viewport can actually show, and widens again when the window does.
    const grid = new GridResizer(clampTileWidth(
      settings.tileWidth,
      maxTileWidthFor(window.innerWidth - VIEWPORT_WIDTH_RESERVE),
    ));
    const ui = new GridUi(shadow, grid, settings.tileWidth);
    const gridStatusListener = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (isGridStatusDetail(detail)) ui.setGridStatus(detail);
    };
    document.addEventListener(GRID_STATUS_EVENT, gridStatusListener);
    grid.start();
    const rowActions = new RowActionManager((resolvePin, size) => createMediaActionHost(
      'row',
      async (action, target) => {
        const pin = resolvePin();
        if (pin) await ui.performPinAction(action, pin, target);
      },
      size,
    ));
    // In the menu placement the hover panel still serves any card that has no
    // footer to sit in, such as the simplified cards of a logged-out board.
    const pinActions = new PinActionManager(
      shadow,
      (action, pin, target) => ui.performPinAction(action, pin, target),
      (pin) => rowActions.serves(pin),
    );
    pinActions.start();
    let cancelRowStart = () => {};
    const applyPlacement = (placement: ButtonPlacement) => {
      cancelRowStart();
      if (placement === 'menu') {
        cancelRowStart = afterHydration(() => {
          rowActions.start();
          pinActions.refreshServed();
        });
      } else {
        rowActions.stop();
      }
    };
    applyPlacement(settings.buttonPlacement);
    const closeupActions = new CloseupActionManager(() => createMediaActionHost(
      'closeup',
      (action, target) => ui.performCloseupAction(action, target),
    ));
    closeupActions.start();

    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && changes.tileWidth?.newValue !== undefined) {
        ui.setTileWidth(changes.tileWidth.newValue as number);
      }
      if (area === 'sync' && changes.buttonPlacement) {
        applyPlacement(normalizeButtonPlacement(changes.buttonPlacement.newValue));
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    ctx.onInvalidated(() => {
      ui.destroy();
      closeupActions.stop();
      cancelRowStart();
      rowActions.stop();
      pinActions.stop();
      grid.stop();
      chrome.storage.onChanged.removeListener(storageListener);
      document.removeEventListener(GRID_STATUS_EVENT, gridStatusListener);
      host.remove();
    });
  },
});
