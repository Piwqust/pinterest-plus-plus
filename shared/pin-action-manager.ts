import { ANY_PIN_SELECTOR, MAX_SCANNED_PINS } from './pin-grid-roots';
import { findFavoriteControl, findGridItem, findMoreControl } from './pinterest-dom';

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
 *
 * A board pin carries a favourite star in its always-visible footer row, and
 * that row is preferred over the three-dot menu the hover overlay hides. Where
 * a card offers neither — the `gated-pin-rep` used for gated boards — the
 * buttons are overlaid on the pin image instead.
 */
export class PinActionManager {
  private observer = new MutationObserver(() => this.queueScan());
  private intersection: IntersectionObserver | null = null;
  private scanTimer: number | undefined;
  private anchorHosts = new WeakMap<HTMLElement, HTMLElement>();
  private pinHosts = new WeakMap<HTMLElement, HTMLElement>();
  private pinRoots = new WeakMap<HTMLElement, HTMLElement>();
  private enrolled = new WeakSet<HTMLElement>();
  private nearViewport = new Set<HTMLElement>();
  private hosts = new Set<HTMLElement>();
  /** Overlaid hosts stay re-checkable so a late-rendering footer wins them back. */
  private overlaid = new WeakSet<HTMLElement>();

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
      const pins = Array.from(root.querySelectorAll<HTMLElement>(ANY_PIN_SELECTOR)).slice(0, MAX_SCANNED_PINS);
      for (const pin of pins) {
        this.pinRoots.set(pin, root);
        if (this.isSettled(pin)) continue;
        if (!this.intersection) {
          this.decorate(pin);
          continue;
        }
        if (this.enrolled.has(pin)) continue;
        this.enrolled.add(pin);
        this.intersection.observe(pin);
      }
    }

    // A pin can gain its footer or menu control after the observer already
    // reported it, so retry the small set that is currently near the viewport.
    for (const pin of this.nearViewport) {
      if (!pin.isConnected) {
        this.nearViewport.delete(pin);
        continue;
      }
      this.decorate(pin);
    }
  }

  /** A pin is settled once it holds a host anchored to a control of its own. */
  private isSettled(pin: HTMLElement): boolean {
    const host = this.pinHosts.get(pin);
    return host !== undefined && host.isConnected && !this.overlaid.has(host);
  }

  private decorate(pin: HTMLElement): void {
    if (!pin.isConnected || this.isSettled(pin)) return;
    const existing = this.pinHosts.get(pin);
    const root = this.pinRoots.get(pin);
    if (!root?.isConnected) return;
    // Presence is enough to justify the control; the full candidate list is
    // only built when the user actually clicks it.
    if (!pin.querySelector(PIN_MEDIA_SELECTOR)) return;
    const item = findGridItem(pin, root);
    const anchor = findFavoriteControl(item) ?? findMoreControl(item);

    if (anchor?.parentElement && !anchor.closest('#pinterest-plus-plus-root')) {
      if (existing?.isConnected) this.release(pin, existing);
      this.attachBefore(pin, anchor);
      return;
    }

    if (existing?.isConnected) return;
    // Last resort for a card that offers no control of its own: overlay the
    // buttons on the pin image so its media stays reachable.
    const host = this.createHost(pin);
    this.applyOverlayStyle(host, pin);
    pin.append(host);
    this.pinHosts.set(pin, host);
    this.hosts.add(host);
    this.overlaid.add(host);
  }

  /** Places `host` as the sibling immediately before Pinterest's own control. */
  private attachBefore(pin: HTMLElement, anchor: HTMLElement): void {
    const existingHost = this.anchorHosts.get(anchor);
    if (existingHost) {
      if (!existingHost.isConnected || existingHost.nextElementSibling !== anchor) {
        anchor.before(existingHost);
      }
      this.pinHosts.set(pin, existingHost);
      return;
    }

    const host = this.createHost(pin);
    anchor.before(host);
    this.anchorHosts.set(anchor, host);
    this.pinHosts.set(pin, host);
    this.hosts.add(host);
  }

  private release(pin: HTMLElement, host: HTMLElement): void {
    host.remove();
    this.hosts.delete(host);
    this.pinHosts.delete(pin);
  }

  private applyOverlayStyle(host: HTMLElement, pin: HTMLElement): void {
    host.style.position = 'absolute';
    host.style.bottom = '6px';
    host.style.right = '6px';
    host.style.zIndex = '10';
    host.style.pointerEvents = 'auto';
    // The overlay is anchored to the pin, which Pinterest may leave static.
    if (getComputedStyle(pin).position === 'static') pin.style.position = 'relative';
  }
}
