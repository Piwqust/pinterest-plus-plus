import { MAX_SCANNED_PINS, PIN_SELECTOR } from './pin-grid-roots';
import { findGridItem, findMoreControl } from './pinterest-dom';

const PIN_MEDIA_SELECTOR = 'img, video';
/** Pins are decorated slightly before they scroll into view. */
const PIN_DECORATION_MARGIN = '300px';
const SCAN_DEBOUNCE = 350;

interface GridRootSource {
  getRoots(): HTMLElement[];
}

/**
 * Adds an extension-owned control beside each pin's three-dot menu. Decoration
 * waits until a pin approaches the viewport, and the caller's factory decides
 * what the control contains, so a deep feed only pays for what is on screen.
 */
export class PinActionManager {
  private observer = new MutationObserver(() => this.queueScan());
  private intersection: IntersectionObserver | null = null;
  private scanTimer: number | undefined;
  private menuHosts = new WeakMap<HTMLElement, HTMLElement>();
  private pinHosts = new WeakMap<HTMLElement, HTMLElement>();
  private pinRoots = new WeakMap<HTMLElement, HTMLElement>();
  private enrolled = new WeakSet<HTMLElement>();
  private nearViewport = new Set<HTMLElement>();
  private hosts = new Set<HTMLElement>();

  constructor(
    private grid: GridRootSource,
    private createHost: (pin: HTMLElement) => HTMLElement,
  ) {}

  start(): void {
    if (typeof IntersectionObserver === 'function') {
      this.intersection = new IntersectionObserver(
        (entries) => this.onIntersections(entries),
        { rootMargin: PIN_DECORATION_MARGIN },
      );
    }
    this.scan();
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  stop(): void {
    this.observer.disconnect();
    this.intersection?.disconnect();
    this.intersection = null;
    if (this.scanTimer !== undefined) window.clearTimeout(this.scanTimer);
    this.nearViewport.clear();
    for (const host of this.hosts) host.remove();
    this.hosts.clear();
  }

  private queueScan = (): void => {
    if (this.scanTimer !== undefined) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = undefined;
      this.scan();
    }, SCAN_DEBOUNCE);
  };

  private onIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const pin = entry.target as HTMLElement;
      if (!entry.isIntersecting) {
        this.nearViewport.delete(pin);
        continue;
      }
      this.nearViewport.add(pin);
      this.decorate(pin);
    }
  }

  private scan(): void {
    for (const root of this.grid.getRoots()) {
      const pins = Array.from(root.querySelectorAll<HTMLElement>(PIN_SELECTOR)).slice(0, MAX_SCANNED_PINS);
      for (const pin of pins) {
        this.pinRoots.set(pin, root);
        if (this.pinHosts.get(pin)?.isConnected) continue;
        if (!this.intersection) {
          this.decorate(pin);
          continue;
        }
        if (this.enrolled.has(pin)) continue;
        this.enrolled.add(pin);
        this.intersection.observe(pin);
      }
    }

    // A pin can gain its menu control after the observer already reported it,
    // so retry the small set that is currently near the viewport.
    for (const pin of this.nearViewport) {
      if (!pin.isConnected) {
        this.nearViewport.delete(pin);
        continue;
      }
      this.decorate(pin);
    }
  }

  private decorate(pin: HTMLElement): void {
    if (!pin.isConnected || this.pinHosts.get(pin)?.isConnected) return;
    const root = this.pinRoots.get(pin);
    if (!root?.isConnected) return;
    // Presence is enough to justify the control; the full candidate list is
    // only built when the user actually clicks it.
    if (!pin.querySelector(PIN_MEDIA_SELECTOR)) return;
    const moreControl = findMoreControl(findGridItem(pin, root));
    if (!moreControl?.parentElement || moreControl.closest('#pinterest-plus-plus-root')) return;

    const existingHost = this.menuHosts.get(moreControl);
    if (existingHost) {
      if (!existingHost.isConnected || existingHost.nextElementSibling !== moreControl) {
        moreControl.before(existingHost);
      }
      this.pinHosts.set(pin, existingHost);
      return;
    }

    const host = this.createHost(pin);
    moreControl.before(host);
    this.menuHosts.set(moreControl, host);
    this.pinHosts.set(pin, host);
    this.hosts.add(host);
  }
}
