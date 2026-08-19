import { findPinCloseup } from './pin-closeup';

const SCAN_DEBOUNCE = 350;

/**
 * Keeps one extension-owned control beside the pin close-up's three-dot menu.
 * Unlike the grid there is only ever a single target, so the close-up is located
 * on every settled mutation instead of being tracked per element, and the host
 * is released as soon as Pinterest navigates back to a feed.
 */
export class CloseupActionManager {
  private observer = new MutationObserver(() => this.queueScan());
  private scanTimer: number | undefined;
  private host: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;

  constructor(private createHost: () => HTMLElement) {}

  start(): void {
    this.scan();
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  stop(): void {
    this.observer.disconnect();
    if (this.scanTimer !== undefined) window.clearTimeout(this.scanTimer);
    this.scanTimer = undefined;
    this.detach();
  }

  private queueScan = (): void => {
    if (this.scanTimer !== undefined) return;
    this.scanTimer = window.setTimeout(() => {
      this.scanTimer = undefined;
      this.scan();
    }, SCAN_DEBOUNCE);
  };

  private scan(): void {
    const closeup = findPinCloseup(document);
    // Presence is enough to justify the control; the media sources are resolved
    // when a button is clicked, against whatever the close-up shows by then.
    if (!closeup || closeup.media.length === 0) {
      this.detach();
      return;
    }

    if (this.host && this.anchor === closeup.anchor && this.anchor.isConnected) {
      if (this.host.nextElementSibling !== this.anchor) this.anchor.before(this.host);
      return;
    }

    this.detach();
    const host = this.createHost();
    closeup.anchor.before(host);
    this.host = host;
    this.anchor = closeup.anchor;
  }

  private detach(): void {
    this.host?.remove();
    this.host = null;
    this.anchor = null;
  }
}
