import { setActionsVisible } from './media-action-host';
import { ANY_PIN_SELECTOR, MAX_SCANNED_PINS } from './pin-grid-roots';

const PIN_MEDIA_SELECTOR = 'img, video';
/** Pins are decorated slightly before they scroll into view. */
const PIN_DECORATION_MARGIN = '300px';
const SCAN_DEBOUNCE = 350;
/** Distance from the media's own corner, which Pinterest leaves free. */
const OVERLAY_INSET = 8;

interface GridRootSource {
  getRoots(): HTMLElement[];
}

function isPositioned(element: HTMLElement): boolean {
  const position = getComputedStyle(element).position;
  return position !== '' && position !== 'static';
}

/**
 * Lays an extension-owned pair of buttons over each pin's media, in the corner
 * Pinterest keeps free, and shows it only while that pin is pointed at or the
 * buttons hold focus. Decoration waits until a pin approaches the viewport, so
 * a deep feed only pays for what is on screen.
 *
 * The buttons take no part in Pinterest's own layout, by design. Inserting
 * them into a tile's control row meant re-inserting them every time that row
 * was rebuilt — which Pinterest does on every hover — and a row that could not
 * fit them wrapped its own controls onto a second line. A box positioned
 * absolutely inside the pin cannot move anything of Pinterest's, whatever the
 * tile turns out to be made of.
 */
export class PinActionManager {
  private observer = new MutationObserver(() => this.onMutations());
  private intersection: IntersectionObserver | null = null;
  private scanTimer: number | undefined;
  private pinHosts = new WeakMap<HTMLElement, HTMLElement>();
  private enrolled = new WeakSet<HTMLElement>();
  private nearViewport = new Set<HTMLElement>();
  private hosts = new Set<HTMLElement>();
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
    // A pin re-rendered under the pointer would otherwise stand without its
    // buttons until the debounced scan comes round.
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
        if (!this.intersection) {
          this.decorate(pin);
          continue;
        }
        if (this.enrolled.has(pin)) continue;
        this.enrolled.add(pin);
        this.intersection.observe(pin);
      }
    }

    // Pinterest can re-render a pin and drop what it does not own, so hosts it
    // discarded are let go of here and the pins that lost them decorated again.
    for (const host of this.hosts) {
      if (!host.isConnected) this.hosts.delete(host);
    }
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
    // Presence is enough to justify the buttons; the full candidate list is
    // only built when the user actually clicks one.
    const media = pin.querySelector<HTMLElement>(PIN_MEDIA_SELECTOR);
    if (!media) return;
    const host = this.createHost(pin);
    host.style.position = 'absolute';
    host.style.zIndex = '3';
    host.style.pointerEvents = 'auto';
    this.frameFor(pin, media).append(host);
    this.place(host, media);
    this.pinHosts.set(pin, host);
    this.hosts.add(host);
    this.settle(pin);
  }

  /**
   * The box the overlay is positioned against: the nearest ancestor of the
   * media that is positioned already. Only a pin that positions nothing at all
   * is given a style of ours, and the least intrusive one there is.
   */
  private frameFor(pin: HTMLElement, media: HTMLElement): HTMLElement {
    for (let node = media.parentElement; node; node = node.parentElement) {
      if (isPositioned(node)) return node;
      if (node === pin) break;
    }
    if (!isPositioned(pin)) pin.style.position = 'relative';
    return pin;
  }

  /** Pins the overlay to the media's own top-left corner within its frame. */
  private place(host: HTMLElement, media: HTMLElement): void {
    const sameFrame = media.offsetParent !== null && media.offsetParent === host.offsetParent;
    host.style.top = `${(sameFrame ? media.offsetTop : 0) + OVERLAY_INSET}px`;
    host.style.left = `${(sameFrame ? media.offsetLeft : 0) + OVERLAY_INSET}px`;
  }

  private onPointerOver = (event: Event): void => {
    const pin = this.pinFrom(event.target);
    if (pin) this.decorate(pin);
    this.setActiveCard('hovered', pin);
  };

  /** The pointer left the page without passing over anything else. */
  private onPointerLeave = (): void => {
    this.setActiveCard('hovered', null);
  };

  private onFocusIn = (event: Event): void => {
    this.setActiveCard('focused', this.pinFrom(event.target));
  };

  private pinFrom(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(ANY_PIN_SELECTOR);
  }

  private setActiveCard(kind: 'hovered' | 'focused', pin: HTMLElement | null): void {
    const previous = this[kind];
    this[kind] = pin;
    if (previous && previous !== pin) this.syncVisibility(previous);
    if (pin) this.syncVisibility(pin);
  }

  /**
   * Brings a freshly attached host to the state its pin is already in. The
   * pointer can have been resting on the pin since before it was decorated,
   * which no move of its own will ever report.
   */
  private settle(pin: HTMLElement): void {
    if (this.hovered !== pin && this.isPointedAt(pin)) this.setActiveCard('hovered', pin);
    else this.syncVisibility(pin);
  }

  /**
   * Puts a pin's buttons in the state the pointer and focus say they are in.
   * Every path that can change either ends here, so a host that was just
   * rebuilt is never left in the state the one before it happened to hold.
   */
  private syncVisibility(pin: HTMLElement): void {
    const host = this.pinHosts.get(pin);
    if (!host?.isConnected) return;
    const visible = this.hovered === pin || this.focused === pin;
    if (visible) {
      // The media may have loaded, or the grid been resized, since the last look.
      const media = pin.querySelector<HTMLElement>(PIN_MEDIA_SELECTOR);
      if (media) this.place(host, media);
    }
    setActionsVisible(host, visible);
  }

  private isPointedAt(pin: HTMLElement): boolean {
    try {
      return pin.matches(':hover');
    } catch {
      return false;
    }
  }
}
