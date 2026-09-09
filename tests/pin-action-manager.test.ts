import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMediaActionHost } from '../shared/media-action-host';
import { PinActionManager } from '../shared/pin-action-manager';

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  observed = new Set<Element>();

  constructor(private callback: IntersectionCallback, readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  /** Reports the given targets as (non-)intersecting, like a real scroll would. */
  report(targets: Element[], isIntersecting = true): void {
    this.callback(targets.map((target) => ({ target, isIntersecting } as IntersectionObserverEntry)));
  }
}

function buildGrid(pinCount: number, withMedia = true): HTMLElement {
  document.body.innerHTML = `
    <main id="grid">
      ${Array.from({ length: pinCount }, (_, index) => `
        <article>
          <div data-test-id="pinWrapper" id="pin-${index}">
            ${withMedia ? '<img src="https://i.pinimg.com/236x/a.jpg" />' : ''}
          </div>
          <button aria-label="More options" id="more-${index}"></button>
        </article>
      `).join('')}
    </main>
  `;
  return document.querySelector<HTMLElement>('#grid')!;
}

/** A board card: an always-visible footer with the favourite star, plus the
 *  three-dot menu Pinterest keeps in the hover overlay. */
function buildBoardGrid(pinCount: number, withStar = true): HTMLElement {
  document.body.innerHTML = `
    <main id="grid">
      ${Array.from({ length: pinCount }, (_, index) => `
        <article>
          <div data-test-id="pinWrapper" id="pin-${index}">
            <img src="https://i.pinimg.com/236x/a.jpg" />
            <button aria-label="More options" id="more-${index}"></button>
          </div>
          <div class="footer">
            <div class="title">Pin ${index}</div>
            ${withStar ? `<div data-test-favorited="false" id="fav-${index}"><div role="button" data-test-id="favorite-button-star"></div></div>` : ''}
          </div>
        </article>
      `).join('')}
    </main>
  `;
  return document.querySelector<HTMLElement>('#grid')!;
}

function hostsInDocument(): number {
  return document.querySelectorAll('[data-ppp-ignore="true"]').length;
}

describe('PinActionManager', () => {
  let manager: PinActionManager | null = null;
  let created: HTMLElement[] = [];

  const createHost = (): HTMLElement => {
    const host = document.createElement('span');
    host.dataset.pppIgnore = 'true';
    created.push(host);
    return host;
  };

  beforeEach(() => {
    created = [];
    FakeIntersectionObserver.instances = [];
    document.body.innerHTML = '';
  });

  afterEach(() => {
    manager?.stop();
    manager = null;
    vi.unstubAllGlobals();
  });

  it('decorates only the pins reported near the viewport', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const root = buildGrid(6);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const observer = FakeIntersectionObserver.instances[0]!;
    expect(observer.observed.size).toBe(6);
    expect(observer.options?.rootMargin).toBe('300px');
    expect(hostsInDocument()).toBe(0);

    observer.report([document.querySelector<HTMLElement>('#pin-2')!]);
    expect(hostsInDocument()).toBe(1);
    expect(document.querySelector('#more-2')!.previousElementSibling).toBe(created[0]);
  });

  it('decorates a pin only once however often it is reported', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const root = buildGrid(3);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const observer = FakeIntersectionObserver.instances[0]!;
    const pin = document.querySelector<HTMLElement>('#pin-1')!;
    observer.report([pin]);
    observer.report([pin]);
    observer.report([pin], false);
    observer.report([pin]);

    expect(created).toHaveLength(1);
    expect(hostsInDocument()).toBe(1);
  });

  it('skips pins that carry no media yet', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const root = buildGrid(3, false);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    FakeIntersectionObserver.instances[0]!.report([document.querySelector<HTMLElement>('#pin-0')!]);
    expect(hostsInDocument()).toBe(0);
  });

  it('decorates every pin when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(4);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    expect(hostsInDocument()).toBe(4);
  });

  it('removes its hosts when stopped', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(4);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();
    manager.stop();
    manager = null;

    expect(hostsInDocument()).toBe(0);
  });

  it('anchors to the board footer star rather than the hover overlay menu', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const root = buildBoardGrid(3);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    FakeIntersectionObserver.instances[0]!.report([document.querySelector<HTMLElement>('#pin-1')!]);
    expect(hostsInDocument()).toBe(1);
    expect(document.querySelector('#fav-1')!.previousElementSibling).toBe(created[0]);
    expect(document.querySelector('#more-1')!.previousElementSibling).not.toBe(created[0]);
  });

  it('falls back to the three-dot menu on a card without a star', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const root = buildBoardGrid(2, false);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    FakeIntersectionObserver.instances[0]!.report([document.querySelector<HTMLElement>('#pin-0')!]);
    expect(document.querySelector('#more-0')!.previousElementSibling).toBe(created[0]);
  });

  it('overlays a gated card that offers no control of its own', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    document.body.innerHTML = `
      <main id="grid">
        <div data-test-id="gated-pin-rep" id="gated-0"><img src="https://i.pinimg.com/236x/a.jpg" /></div>
        <div data-test-id="gated-pin-rep" id="gated-1"><img src="https://i.pinimg.com/236x/b.jpg" /></div>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#grid')!;
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    expect(hostsInDocument()).toBe(2);
    expect(document.querySelector('#gated-0')!.lastElementChild).toBe(created[0]);
    expect(created[0]!.style.position).toBe('absolute');
  });

  it('moves an overlaid host into the footer once the star renders', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    document.body.innerHTML = `
      <main id="grid">
        <article><div data-test-id="gated-pin-rep" id="gated-0"><img src="https://i.pinimg.com/236x/a.jpg" /></div></article>
        <article><div data-test-id="gated-pin-rep" id="gated-1"><img src="https://i.pinimg.com/236x/b.jpg" /></div></article>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#grid')!;
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const observer = FakeIntersectionObserver.instances[0]!;
    const pin = document.querySelector<HTMLElement>('#gated-0')!;
    observer.report([pin]);
    expect(hostsInDocument()).toBe(1);
    const overlay = created[0]!;
    expect(overlay.style.position).toBe('absolute');

    pin.closest('article')!.insertAdjacentHTML(
      'beforeend',
      '<div data-test-favorited="false" id="fav-0"><div role="button" data-test-id="favorite-button-star"></div></div>',
    );
    observer.report([pin]);

    expect(hostsInDocument()).toBe(1);
    expect(overlay.isConnected).toBe(false);
    expect(document.querySelector('#fav-0')!.previousElementSibling).toBe(created[1]);
  });

  it('chips an overlaid host so its icons read against the image', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    document.body.innerHTML = `
      <main id="grid">
        <div data-test-id="gated-pin-rep" id="gated-0"><img src="https://i.pinimg.com/236x/a.jpg" /></div>
        <div data-test-id="gated-pin-rep" id="gated-1"><img src="https://i.pinimg.com/236x/b.jpg" /></div>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#grid')!;
    manager = new PinActionManager(
      { getRoots: () => [root] },
      () => createMediaActionHost('grid', async () => {}),
    );
    manager.start();

    const host = document.querySelector<HTMLElement>('#gated-0 [data-ppp-ignore="true"]')!;
    expect(host.shadowRoot!.querySelector<HTMLElement>('.ppp-pin-actions')!.dataset.chip).toBe('true');
  });

  it('takes the chip of a neighbour that only paints one on hover', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(2);
    manager = new PinActionManager(
      { getRoots: () => [root] },
      () => createMediaActionHost('grid', async () => {}),
    );
    manager.start();

    const pin = document.querySelector<HTMLElement>('#pin-0')!;
    const host = document.querySelector<HTMLElement>('#more-0')!.previousElementSibling as HTMLElement;
    const actions = host.shadowRoot!.querySelector<HTMLElement>('.ppp-pin-actions')!;
    expect(actions.dataset.chip).toBeUndefined();

    document.querySelector<HTMLElement>('#more-0')!.style.backgroundColor = 'rgb(255, 255, 255)';
    pin.dispatchEvent(new Event('pointerenter'));

    expect(actions.dataset.chip).toBe('true');
    expect(host.style.getPropertyValue('--ppp-chip-bg')).toBe('rgb(255, 255, 255)');
  });
});
