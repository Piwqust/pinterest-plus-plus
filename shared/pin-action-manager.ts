import { chipFor } from './action-chip';
import { setActionChip, setActionsVisible } from './media-action-host';
import { ANY_PIN_SELECTOR, MAX_SCANNED_PINS } from './pin-grid-roots';
import { findFavoriteControl, findGridItem, findMoreControl } from './pinterest-dom';

const PIN_MEDIA_SELECTOR = 'img, video';
/** Pins are decorated slightly before they scroll into view. */
const PIN_DECORATION_MARGIN = '300px';
const SCAN_DEBOUNCE = 350;
/** How far above a hovered node the card that owns it is looked for. */
const HOVER_LOOKUP_DEPTH = 16;

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
 *
 * A pin without a title has no footer row at all: Pinterest lays that pin's
 * controls onto the image, where a bare icon is unreadable. Such a row is
 * detected from the neighbouring control and the buttons take its chip.
 *
 * Like Pinterest's own tile controls, the buttons stay hidden until the card
 * they belong to is pointed at or they take keyboard focus. One delegated
 * listener serves the whole feed, since a virtualized grid recycles its cards.
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
  private hostAnchors = new WeakMap<HTMLElement, HTMLElement>();
  /** Every node a pointer can land on that belongs to a decorated card. */
  private cardPins = new WeakMap<HTMLElement, HTMLElement>();
  private hovered: HTMLElement | null = null;
  private focused: HTMLElement | null = null;

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
    document.addEventListener('pointerover', this.onPointerOver, { passive: true });
    document.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    document.addEventListener('focusin', this.onFocusIn, { passive: true });
  }

  stop(): void {
    document.removeEventListener('pointerover', this.onPointerOver);
    document.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('focusin', this.onFocusIn);
    this.hovered = null;
    this.focused = null;
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
    // The buttons can end up outside the pin itself, in a footer beside it, so
    // the whole card counts as the surface that reveals them.
    this.cardPins.set(item, pin);
    this.cardPins.set(pin, pin);
    const anchor = findFavoriteControl(item) ?? findMoreControl(item);

    if (anchor?.parentElement && !anchor.closest('#pinterest-plus-plus-root')) {
      if (existing?.isConnected) this.release(pin, existing);
      this.attachBefore(pin, anchor);
      this.refreshChip(pin);
      if (this.isPointedAt(item)) this.setActiveCard('hovered', pin);
      else this.reveal(pin, this.isActive(pin));
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
    setActionChip(host, chipFor(pin, null));
    if (this.isPointedAt(pin)) this.setActiveCard('hovered', pin);
    else setActionsVisible(host, this.isActive(pin));
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
    this.hostAnchors.set(host, anchor);
    this.hosts.add(host);
  }

  private onPointerOver = (event: Event): void => {
    this.setActiveCard('hovered', this.cardFrom(event.target));
  };

  /** The pointer left the page without passing over anything else. */
  private onPointerLeave = (): void => {
    this.setActiveCard('hovered', null);
  };

  private onFocusIn = (event: Event): void => {
    this.setActiveCard('focused', this.cardFrom(event.target));
  };

  /** The decorated pin owning the node under the pointer, if there is one. */
  private cardFrom(target: EventTarget | null): HTMLElement | null {
    let node = target instanceof Element ? target : null;
    for (let depth = 0; node && depth < HOVER_LOOKUP_DEPTH; depth += 1, node = node.parentElement) {
      const pin = this.cardPins.get(node as HTMLElement);
      if (pin?.isConnected) return pin;
    }
    return null;
  }

  private isActive(pin: HTMLElement): boolean {
    return pin === this.hovered || pin === this.focused;
  }

  /**
   * A card is decorated lazily, so the pointer can already be resting on it
   * with no move left to report. Asking the card itself covers that.
   */
  private isPointedAt(card: HTMLElement): boolean {
    try {
      return card.matches(':hover');
    } catch {
      return false;
    }
  }

  private setActiveCard(kind: 'hovered' | 'focused', pin: HTMLElement | null): void {
    const previous = this[kind];
    if (previous === pin) return;
    this[kind] = pin;
    // The other role can still be holding the card the pointer just left.
    if (previous && previous !== this.hovered && previous !== this.focused) this.reveal(previous, false);
    if (pin) this.reveal(pin, true);
  }

  private reveal(pin: HTMLElement, visible: boolean): void {
    const host = this.pinHosts.get(pin);
    if (!host?.isConnected) return;
    setActionsVisible(host, visible);
    // A row Pinterest paints on hover is only measurable now that it is drawn.
    if (visible) this.refreshChip(pin);
  }

  private refreshChip(pin: HTMLElement): void {
    const host = this.pinHosts.get(pin);
    if (!host?.isConnected) return;
    const anchor = this.hostAnchors.get(host);
    // A stale anchor means the row is being rebuilt; the next scan re-attaches.
    if (anchor && !anchor.isConnected) return;
    setActionChip(host, chipFor(pin, anchor ?? null));
  }

  private release(pin: HTMLElement, host: HTMLElement): void {
    host.remove();
    this.hostAnchors.delete(host);
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
