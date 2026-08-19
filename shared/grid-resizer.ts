import {
  GRID_DESTROY_EVENT,
  GRID_SET_WIDTH_EVENT,
  type GridSetWidthDetail,
} from './grid-bridge-events';
import { PIN_SELECTOR, containsPin, findPinGridRootsFrom, samplePins } from './pin-grid-roots';
import { DEFAULT_TILE_WIDTH, clampTileWidth } from './settings';

export class GridResizer {
  private observer = new MutationObserver((records) => this.onMutations(records));
  private scanTimer: number | undefined;
  private roots = new Set<HTMLElement>();
  private requestId = 0;

  constructor(private width: number) {
    this.width = clampTileWidth(width);
  }

  start(): void {
    this.scan();
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.dispatchWidth();
  }

  stop(): void {
    this.observer.disconnect();
    if (this.scanTimer !== undefined) window.clearTimeout(this.scanTimer);
    document.dispatchEvent(new CustomEvent(GRID_DESTROY_EVENT));
    for (const root of this.roots) this.releaseRoot(root);
    this.roots.clear();
  }

  applyWidth(value: number): void {
    const normalized = clampTileWidth(value);
    if (normalized === this.width) return;
    this.width = normalized;
    for (const root of this.getRoots()) this.updateRootState(root);
    this.dispatchWidth();
  }

  getRoots(): HTMLElement[] {
    return [...this.roots].filter((root) => root.isConnected);
  }

  private queueScan = (): void => {
    if (this.scanTimer !== undefined) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = undefined;
      this.scan();
    }, 100);
  };

  private onMutations(records: MutationRecord[]): void {
    const roots = this.getRoots();
    for (const record of records) {
      if (Array.from(record.removedNodes).some(containsPin)) {
        this.queueScan();
        return;
      }

      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || node.closest('[data-ppp-ignore="true"]')) continue;
        const pins = node.matches(PIN_SELECTOR)
          ? [node]
          : Array.from(node.querySelectorAll<HTMLElement>(PIN_SELECTOR));
        if (pins.some((pin) => !roots.some((root) => root.contains(pin)))) {
          this.queueScan();
          return;
        }
      }
    }
  }

  private scan(): void {
    // Being detached is the only reliable liveness test. A mounted grid can be
    // momentarily empty mid-reflow, and dropping it there would lose the pin
    // actions until enough pins exist to rediscover it.
    for (const root of this.roots) {
      if (root.isConnected) continue;
      this.releaseRoot(root);
      this.roots.delete(root);
    }

    const connectedRoots = this.getRoots();
    const undiscoveredPins = samplePins(document)
      .filter((pin) => !connectedRoots.some((root) => root.contains(pin)));
    // Large tiles leave only a couple of pins mounted, so a single stray pin is
    // still worth a scan; the width test below is what rejects non-grids.
    if (undiscoveredPins.length === 0) return;

    const roots = findPinGridRootsFrom(
      undiscoveredPins,
      window.innerWidth,
      document,
      (ancestor) => !connectedRoots.some((root) => ancestor.contains(root)),
    );
    for (const root of roots) {
      this.roots.add(root);
      root.dataset.pppGridRoot = 'true';
      this.updateRootState(root);
    }
  }

  private updateRootState(root: HTMLElement): void {
    if (this.width === DEFAULT_TILE_WIDTH) delete root.dataset.pppGridResized;
    else root.dataset.pppGridResized = 'true';
  }

  private dispatchWidth(): void {
    const detail: GridSetWidthDetail = { requestId: ++this.requestId, width: this.width };
    document.dispatchEvent(new CustomEvent<GridSetWidthDetail>(GRID_SET_WIDTH_EVENT, { detail }));
  }

  private releaseRoot(root: HTMLElement): void {
    delete root.dataset.pppGridRoot;
    delete root.dataset.pppGridResized;
  }
}
