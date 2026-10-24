import { GridResizer } from '../shared/grid-resizer';
import {
  GRID_STATUS_EVENT,
  isGridStatusDetail,
} from '../shared/grid-bridge-events';
import { GridUi, VIEWPORT_WIDTH_RESERVE } from '../shared/grid-ui';
import { createMediaActionHost, setCollected, type HostAction } from '../shared/media-action-host';
import { CollectionPanel } from '../shared/collection-panel';
import { COLLECTION_CSS } from '../shared/collection-css';
import { CollectionStore } from '../shared/collection-store';
import { pinKey, type CollectedPin } from '../shared/collection';
import { captureCloseup, capturePin } from '../shared/pin-capture';
import { findPinId, pinIdFromUrl } from '../shared/pin-data';
import { collectPinMedia } from '../shared/media';
import { PinActionManager } from '../shared/pin-action-manager';
import { CloseupActionManager } from '../shared/closeup-action-manager';
import { RowActionManager } from '../shared/row-action-manager';
import {
  clampTileWidth,
  isCollectionPrefChange,
  maxTileWidthFor,
  normalizeButtonPlacement,
  readCollectionPrefs,
  readSettings,
  type ButtonPlacement,
} from '../shared/settings';
import { SHADOW_CSS } from '../shared/ui-assets';

/**
 * The key a grid pin is collected under, read without capturing the whole pin,
 * since it is asked for every time the pointer moves onto another tile.
 */
function keyOfPin(pin: HTMLElement): string | null {
  const pinId = findPinId(pin);
  if (pinId) return pinId;
  const media = collectPinMedia(pin)[0];
  return media ? pinKey(null, [...media.candidates, ...media.posterCandidates, ...media.streams]) : null;
}

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
    shadowStyle.textContent = SHADOW_CSS + COLLECTION_CSS;
    shadow.append(shadowStyle);
    document.documentElement.append(host);

    const [settings, collectionPrefs, store] = await Promise.all([
      readSettings(),
      readCollectionPrefs(),
      CollectionStore.open(),
    ]);
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

    const layer = shadow.querySelector<HTMLElement>('.ppp-layer')!;
    const collection = new CollectionPanel(layer, store, collectionPrefs, (message, error) => ui.showToast(message, error));
    ui.mountCornerControl(collection.launcher);

    /** Adds a pin to the collection, or takes it out if it is already there. */
    const toggleCollected = (draft: CollectedPin | null) => {
      if (!draft) {
        ui.showToast('No Pinterest media is available for this pin', true);
        return;
      }
      if (store.has(draft.key)) {
        store.remove([draft.key]);
        ui.showToast('Removed from your collection');
        return;
      }
      const result = store.add([draft]);
      if (result.full > 0) {
        ui.showToast('Your collection is full. Remove some pins to add more.', true);
        return;
      }
      collection.measureNew();
      ui.showToast(`Added to your collection · ${store.snapshot.pins.length}`);
    };
    const onPinAction = async (action: HostAction, pin: HTMLElement, target: HTMLButtonElement) => {
      if (action === 'collect') toggleCollected(capturePin(pin));
      else await ui.performPinAction(action, pin, target);
    };

    /** Hosts whose bookmark has to follow the collection, each with the key it shows. */
    const keyedHosts = new Map<HTMLElement, () => string | null>();
    const refreshHost = (host: HTMLElement, key: () => string | null) => setCollected(host, store.has(key()));

    const rowActions = new RowActionManager((resolvePin, size) => {
      const host = createMediaActionHost(
        'row',
        async (action, target) => {
          const pin = resolvePin();
          if (pin) await onPinAction(action, pin, target);
        },
        size,
      );
      const key = () => {
        const pin = resolvePin();
        return pin ? keyOfPin(pin) : null;
      };
      keyedHosts.set(host, key);
      // The card is attached right after this returns; its state is read once it is.
      queueMicrotask(() => refreshHost(host, key));
      return host;
    });
    // In the menu placement the hover panel still serves any card that has no
    // footer to sit in, such as the simplified cards of a logged-out board.
    const pinActions = new PinActionManager(
      shadow,
      onPinAction,
      (pin) => rowActions.serves(pin),
      (pin, host) => setCollected(host, Boolean(pin) && store.has(keyOfPin(pin!))),
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
    const closeupKey = () => {
      const pinId = pinIdFromUrl(location.href);
      return pinId ?? captureCloseup()?.key ?? null;
    };
    const closeupActions = new CloseupActionManager(() => {
      const host = createMediaActionHost('closeup', async (action, target) => {
        if (action === 'collect') toggleCollected(captureCloseup());
        else await ui.performCloseupAction(action, target);
      });
      keyedHosts.set(host, closeupKey);
      queueMicrotask(() => refreshHost(host, closeupKey));
      return host;
    });
    closeupActions.start();

    const unsubscribe = store.subscribe(() => {
      pinActions.refreshActive();
      for (const [host, key] of keyedHosts) {
        if (host.isConnected) refreshHost(host, key);
        else keyedHosts.delete(host);
      }
    });

    const storageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      store.onStorageChanged(changes, area);
      if (area === 'sync' && isCollectionPrefChange(changes)) {
        void readCollectionPrefs().then((prefs) => collection.setPrefs(prefs));
      }
      if (area === 'sync' && changes.tileWidth?.newValue !== undefined) {
        ui.setTileWidth(changes.tileWidth.newValue as number);
      }
      if (area === 'sync' && changes.buttonPlacement) {
        applyPlacement(normalizeButtonPlacement(changes.buttonPlacement.newValue));
      }
    };
    chrome.storage.onChanged.addListener(storageListener);

    ctx.onInvalidated(() => {
      unsubscribe();
      collection.destroy();
      store.destroy();
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
