import { createMediaActionHost, setActionsVisible, type MediaAction } from './media-action-host';
import { ANY_PIN_SELECTOR } from './pin-grid-roots';

const PIN_MEDIA_SELECTOR = 'img, video';
/** Inset from the media's bottom-left corner, matching Pinterest's own row. */
const OVERLAY_INSET = 12;
/** Gap left between the panel and a control it had to rise above. */
const OVERLAY_GAP = 8;
/** What the panel refuses to sit on top of inside a pin. */
const FOREIGN_CONTROL_SELECTOR = 'a[href], button, [role="button"]';
/** Of the media's area, what a control must stay under to count as one. */
const COVER_SHARE = 0.5;
/** Fallbacks for the first placement, before the panel has been measured. */
const PANEL_WIDTH = 68;
const PANEL_HEIGHT = 32;

type PinAction = (action: MediaAction, pin: HTMLElement, target: HTMLButtonElement) => Promise<void>;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Shows a Copy/Download panel over the pin under the pointer, in the corner
 * Pinterest keeps free, and follows that pin while the page scrolls.
 *
 * The panel lives in the extension's own top-level layer rather than in
 * Pinterest's DOM. Everything tried before put it inside the tile: first in
 * the control row, where it had to be re-inserted on every hover and could
 * push Pinterest's own controls onto a second line; then absolutely inside the
 * pin, where an invisible layer of theirs won the stacking order and swallowed
 * the click. From its own layer the panel cannot disturb their layout, cannot
 * be discarded by their re-render, and cannot be covered by anything they draw.
 *
 * One panel serves the whole feed, since only one pin is ever pointed at.
 */
export class PinActionManager {
  private host: HTMLElement;
  private root: Element;
  private active: HTMLElement | null = null;
  private frameQueued = false;

  constructor(layer: ShadowRoot, private onAction: PinAction) {
    this.root = layer.host;
    this.host = createMediaActionHost('grid', (action, target) => this.run(action, target));
    this.host.style.position = 'fixed';
    // First in the layer, so the picker and the toast still open above it.
    layer.prepend(this.host);
  }

  start(): void {
    // Capture, so a page that stops these events on the way up cannot blind us.
    document.addEventListener('pointerover', this.onPointerOver, { passive: true, capture: true });
    document.addEventListener('focusin', this.onFocusIn, { passive: true, capture: true });
    document.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    window.addEventListener('scroll', this.onViewportChange, { passive: true, capture: true });
    window.addEventListener('resize', this.onViewportChange, { passive: true });
  }

  stop(): void {
    document.removeEventListener('pointerover', this.onPointerOver, true);
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    this.active = null;
    this.host.remove();
  }

  private run(action: MediaAction, target: HTMLButtonElement): Promise<void> {
    const pin = this.active;
    if (!pin?.isConnected) return Promise.resolve();
    return this.onAction(action, pin, target);
  }

  private onPointerOver = (event: Event): void => {
    this.trackFrom(event.target);
  };

  private onFocusIn = (event: Event): void => {
    this.trackFrom(event.target);
  };

  /** The pointer left the page without passing over anything else. */
  private onPointerLeave = (): void => {
    this.setActive(null);
  };

  private trackFrom(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;
    // Reaching the panel itself must not count as leaving the pin it serves.
    if (target === this.root || this.root.contains(target)) return;
    this.setActive(target.closest<HTMLElement>(ANY_PIN_SELECTOR));
  }

  private onViewportChange = (): void => {
    if (!this.active) return;
    if (this.frameQueued) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.refresh();
      return;
    }
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      this.refresh();
    });
  };

  private setActive(pin: HTMLElement | null): void {
    this.active = pin;
    this.refresh();
  }

  /** Places the panel over the active pin, or takes it away when there is none. */
  private refresh(): void {
    const pin = this.active;
    setActionsVisible(this.host, Boolean(pin?.isConnected) && this.place(pin!));
  }

  private place(pin: HTMLElement): boolean {
    const media = pin.querySelector<HTMLElement>(PIN_MEDIA_SELECTOR);
    if (!media) return false;
    const frame = media.getBoundingClientRect();
    // A tile too small to hold the panel, or one not laid out at all, gets none.
    if (frame.width < PANEL_WIDTH + OVERLAY_INSET || frame.height < PANEL_HEIGHT + OVERLAY_INSET) {
      return false;
    }
    const panel = this.host.getBoundingClientRect();
    const box: Box = {
      left: frame.left + OVERLAY_INSET,
      top: frame.bottom - (panel.height || PANEL_HEIGHT) - OVERLAY_INSET,
      width: panel.width || PANEL_WIDTH,
      height: panel.height || PANEL_HEIGHT,
    };
    const top = Math.max(frame.top + OVERLAY_INSET, box.top - this.clearance(pin, media, box));
    this.host.style.left = `${Math.round(box.left)}px`;
    this.host.style.top = `${Math.round(top)}px`;
    return true;
  }

  /**
   * How far the panel has to rise to clear a control of Pinterest's that holds
   * the same corner — the "Visit site" pill of a linked pin, or their own row
   * on a tile too narrow to hold both.
   *
   * Only controls that sit in the corner count. A tile is wrapped in a link
   * that covers the whole media, and a hover overlay covers it too; rising
   * above those would push the panel off the pin, and there is nothing to rise
   * above anyway, since they are the surface rather than something on it.
   */
  private clearance(pin: HTMLElement, media: HTMLElement, box: Box): number {
    const frame = media.getBoundingClientRect();
    const wide = frame.width * frame.height * COVER_SHARE;
    const right = box.left + box.width;
    const bottom = box.top + box.height;
    let lift = 0;
    for (const control of pin.querySelectorAll<HTMLElement>(FOREIGN_CONTROL_SELECTOR)) {
      if (control === media || control.contains(media)) continue;
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.width * rect.height >= wide) continue;
      if (rect.left >= right || rect.right <= box.left) continue;
      if (rect.top >= bottom || rect.bottom <= box.top) continue;
      lift = Math.max(lift, bottom - rect.top + OVERLAY_GAP);
    }
    return lift;
  }
}
