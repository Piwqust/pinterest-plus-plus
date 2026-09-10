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
  private observer = new MutationObserver(() => this.onMutations());
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
  /** Pins that have held a control of their own at least once. */
  private anchored = new WeakSet<HTMLElement>();
  /** Overlaid hosts waiting out the frame a hover row would arrive in. */
  private pendingReveal = new WeakSet<HTMLElement>();
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

  private onMutations(): void {
    // The row under the pointer is rebuilt as part of hovering, and our buttons
    // go with it, so that one card cannot wait for the debounced scan.
    if (this.hovered?.isConnected) this.decorate(this.hovered);
    this.queueScan();
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

    // Pinterest discards a hover row wholesale, so hosts it took with it are
    // dropped here rather than held for the life of the page.
    for (const host of this.hosts) {
      if (!host.isConnected) this.hosts.delete(host);
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
      this.anchored.add(pin);
      this.attachBefore(pin, anchor);
      this.refreshChip(pin);
      this.settle(pin, item);
      return;
    }

    if (existing?.isConnected) return;
    // A tile whose controls only exist while it is hovered loses ours with
    // them; the next hover rebuilds the row and re-anchors, so an overlay in
    // the meantime would only churn hosts behind a hidden card.
    if (this.anchored.has(pin)) return;
    // Last resort for a card that offers no control of its own: overlay the
    // buttons on the pin image so its media stays reachable.
    const host = this.createHost(pin);
    this.applyOverlayStyle(host, pin);
    pin.append(host);
    this.pinHosts.set(pin, host);
    this.hosts.add(host);
    this.overlaid.add(host);
    setActionChip(host, chipFor(pin, null));
    this.settle(pin, pin);
  }

  /**
   * Brings a freshly attached host to the state its card is already in. The
   * pointer may have been resting on the card since before it was decorated,
   * which no move of its own will ever report.
   */
  private settle(pin: HTMLElement, card: HTMLElement): void {
    if (this.hovered !== pin && this.isPointedAt(card)) this.setActiveCard('hovered', pin);
    else this.syncVisibility(pin);
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
    const pin = this.cardFrom(event.target);
    // Pinterest rebuilds a tile's overlay row on every hover and takes our
    // buttons with it. Re-decorating the card under the pointer right away is
    // what keeps them there; the debounced scan is only a backstop.
    if (pin) this.decorate(pin);
    this.setActiveCard('hovered', pin);
  };

  /** The pointer left the page without passing over anything else. */
  private onPointerLeave = (): void => {
    this.setActiveCard('hovered', null);
  };

  private onFocusIn = (event: Event): void => {
    this.setActiveCard('focused', this.cardFrom(event.target));
  };

  /** The pin owning the node under the pointer, if there is one. */
  private cardFrom(target: EventTarget | null): HTMLElement | null {
    const element = target instanceof Element ? target : null;
    if (!element) return null;
    let node: HTMLElement | null = element as HTMLElement;
    for (let depth = 0; node && depth < HOVER_LOOKUP_DEPTH; depth += 1, node = node.parentElement) {
      const pin = this.cardPins.get(node);
      if (pin?.isConnected) return pin;
    }
    // A card the scan has not reached yet is still worth decorating on sight.
    return element.closest<HTMLElement>(ANY_PIN_SELECTOR);
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
    this[kind] = pin;
    if (previous && previous !== pin) this.syncVisibility(previous);
    if (pin) this.syncVisibility(pin);
  }

  /**
   * Puts a card's buttons in the state the pointer and focus say they should
   * be in. Every path that can change either ends here, so a host that was
   * just rebuilt is never left in the state the one before it happened to be.
   */
  private syncVisibility(pin: HTMLElement): void {
    const host = this.pinHosts.get(pin);
    if (!host?.isConnected) return;
    if (!this.isActive(pin)) {
      setActionsVisible(host, false);
      return;
    }
    // An overlaid host is what a card gets while no row of its own has been
    // seen. Pinterest mounts that row in the frame the hover starts, so a
    // frame's grace keeps the buttons from flashing in the corner first.
    if (this.overlaid.has(host)) {
      this.revealOverlaid(pin, host);
      return;
    }
    this.show(pin, host);
  }

  private revealOverlaid(pin: HTMLElement, host: HTMLElement): void {
    if (this.pendingReveal.has(host) || typeof requestAnimationFrame !== 'function') {
      if (!this.pendingReveal.has(host)) this.show(pin, host);
      return;
    }
    this.pendingReveal.add(host);
    requestAnimationFrame(() => {
      this.pendingReveal.delete(host);
      // The row may have arrived and taken the buttons with it by now.
      if (host.isConnected && this.pinHosts.get(pin) === host && this.isActive(pin)) this.show(pin, host);
    });
  }

  private show(pin: HTMLElement, host: HTMLElement): void {
    setActionsVisible(host, true);
    // A row Pinterest paints on hover is only measurable now that it is drawn.
    this.refreshChip(pin);
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
