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

/** A feed of plain pins: an image inside a wrapper, as a fresh tile arrives. */
function buildGrid(pinCount: number, withMedia = true): HTMLElement {
  document.body.innerHTML = `
    <main id="grid">
      ${Array.from({ length: pinCount }, (_, index) => `
        <article>
          <div data-test-id="pinWrapper" id="pin-${index}">
            ${withMedia ? `<img src="https://i.pinimg.com/236x/${index}.jpg" />` : ''}
          </div>
          <div class="footer"><div class="title">Pin ${index}</div></div>
        </article>
      `).join('')}
    </main>
  `;
  return document.querySelector<HTMLElement>('#grid')!;
}

/**
 * jsdom never matches `:hover`, so a browser's answer is stood in for: every
 * ancestor of the pointed-at node reports itself as hovered.
 */
function stubHover(target: Element | null): () => void {
  const original = Element.prototype.matches;
  Element.prototype.matches = function matches(this: Element, selector: string): boolean {
    if (selector === ':hover') return target !== null && this.contains(target);
    return original.call(this, selector);
  } as typeof Element.prototype.matches;
  return () => { Element.prototype.matches = original; };
}

function hostIn(pin: Element): HTMLElement | null {
  return pin.querySelector<HTMLElement>('[data-ppp-ignore="true"]');
}

function hostsInDocument(): number {
  return document.querySelectorAll('[data-ppp-ignore="true"]').length;
}

function pointerOver(target: Element): void {
  target.dispatchEvent(new Event('pointerover', { bubbles: true }));
}

describe('PinActionManager', () => {
  let manager: PinActionManager | null = null;
  let created: HTMLElement[] = [];
  const restores: Array<() => void> = [];

  const createHost = (): HTMLElement => {
    const host = createMediaActionHost('grid', async () => {});
    created.push(host);
    return host;
  };

  beforeEach(() => {
    created = [];
    FakeIntersectionObserver.instances = [];
    document.body.innerHTML = '';
  });

  afterEach(() => {
    for (const restore of restores.splice(0)) restore();
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
    expect(hostIn(document.querySelector('#pin-2')!)).toBe(created[0]);
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
    observer.report([pin]);

    expect(hostsInDocument()).toBe(1);
  });

  it('skips pins that carry no media yet', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(3, false);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

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
    const root = buildGrid(3);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();
    expect(hostsInDocument()).toBe(3);

    manager.stop();
    manager = null;

    expect(hostsInDocument()).toBe(0);
  });

  it('lays the buttons over the pin without joining anything of Pinterest`s', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    document.body.innerHTML = `
      <main id="grid">
        <article><div data-test-id="pinWrapper" id="pin-0">
          <img src="https://i.pinimg.com/236x/a.jpg" />
          <div class="overlay"><button aria-label="Share"></button><button aria-label="More options"></button></div>
        </div></article>
        <article><div data-test-id="pinWrapper" id="pin-1"><img src="https://i.pinimg.com/236x/b.jpg" /></div></article>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#grid')!;
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const pin = document.querySelector<HTMLElement>('#pin-0')!;
    const host = hostIn(pin)!;
    // Nothing of Pinterest's is a sibling, an ancestor or a neighbour of ours.
    expect(host.closest('.overlay')).toBeNull();
    expect(host.style.position).toBe('absolute');
    expect(host.style.top).toBe('8px');
    expect(host.style.left).toBe('8px');
    expect(pin.querySelector('.overlay')!.children.length).toBe(2);
  });

  it('positions a pin that positions nothing itself, and only such a pin', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    document.body.innerHTML = `
      <main id="grid">
        <article><div data-test-id="pinWrapper" id="pin-0"><div id="frame-0" style="position: relative"><img src="https://i.pinimg.com/236x/a.jpg" /></div></div></article>
        <article><div data-test-id="pinWrapper" id="pin-1"><img src="https://i.pinimg.com/236x/b.jpg" /></div></article>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#grid')!;
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    // The pin already offers a positioned box, so it is left untouched.
    expect(hostIn(document.querySelector('#pin-0')!)!.parentElement!.id).toBe('frame-0');
    expect(document.querySelector<HTMLElement>('#pin-0')!.style.position).toBe('');
    expect(document.querySelector<HTMLElement>('#pin-1')!.style.position).toBe('relative');
  });

  it('keeps the buttons out of sight until the pin is pointed at', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(2);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const pin = document.querySelector<HTMLElement>('#pin-0')!;
    const host = hostIn(pin)!;
    expect(host.dataset.pppHidden).toBe('true');

    pointerOver(pin.querySelector('img')!);
    expect(host.dataset.pppHidden).toBeUndefined();

    pointerOver(document.body);
    expect(host.dataset.pppHidden).toBe('true');
  });

  it('reveals the pin the pointer moved to, not the one it left', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(2);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const first = hostIn(document.querySelector('#pin-0')!)!;
    const second = hostIn(document.querySelector('#pin-1')!)!;

    pointerOver(document.querySelector('#pin-0')!);
    expect(first.dataset.pppHidden).toBeUndefined();
    expect(second.dataset.pppHidden).toBe('true');

    pointerOver(document.querySelector('#pin-1')!);
    expect(first.dataset.pppHidden).toBe('true');
    expect(second.dataset.pppHidden).toBeUndefined();
  });

  it('reveals the buttons for a keyboard user and hides them when focus moves on', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(2);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const host = hostIn(document.querySelector('#pin-0')!)!;

    host.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(host.dataset.pppHidden).toBeUndefined();

    document.body.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(host.dataset.pppHidden).toBe('true');
  });

  it('shows the buttons of a pin decorated under a resting pointer', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const root = buildGrid(2);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const pin = document.querySelector<HTMLElement>('#pin-0')!;
    restores.push(stubHover(pin));
    // No pointer move reports a pin that scrolls in under a still cursor.
    FakeIntersectionObserver.instances[0]!.report([pin]);

    expect(hostIn(pin)!.dataset.pppHidden).toBeUndefined();
  });

  it('restores the buttons a re-render of the pin discarded, still shown', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(2);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const pin = document.querySelector<HTMLElement>('#pin-0')!;
    restores.push(stubHover(pin));
    pointerOver(pin);
    const first = hostIn(pin)!;

    // Pinterest re-renders the tile and throws out what it does not own.
    first.remove();
    await Promise.resolve();

    const second = hostIn(pin)!;
    expect(second).not.toBe(first);
    expect(second.dataset.pppHidden).toBeUndefined();
  });

  it('survives a pin re-rendered on every hover', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(2);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();

    const pin = document.querySelector<HTMLElement>('#pin-0')!;

    for (let pass = 0; pass < 3; pass += 1) {
      const restoreHover = stubHover(pin);
      pointerOver(pin);
      const host = hostIn(pin)!;
      expect(host, `pass ${pass}: buttons attached`).not.toBeNull();
      expect(host.dataset.pppHidden, `pass ${pass}: shown while hovered`).toBeUndefined();

      restoreHover();
      pointerOver(document.body);
      expect(host.dataset.pppHidden, `pass ${pass}: hidden after leaving`).toBe('true');

      // The tile is rebuilt between hovers, taking our buttons with it.
      host.remove();
      await Promise.resolve();
    }
  });

  it('drops its listeners when stopped', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = buildGrid(2);
    manager = new PinActionManager({ getRoots: () => [root] }, createHost);
    manager.start();
    const pin = document.querySelector<HTMLElement>('#pin-0')!;
    manager.stop();
    manager = null;

    expect(() => pointerOver(pin)).not.toThrow();
    expect(hostsInDocument()).toBe(0);
  });
});
