import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaAction } from '../shared/media-action-host';
import { PinActionManager } from '../shared/pin-action-manager';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** jsdom measures nothing, so a test states the rects placement depends on. */
function stubRect(element: Element, rect: Rect): void {
  element.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  }) as DOMRect;
}

/** Tiles laid out where the test says, each with its image filling it. */
function buildFeed(rects: Rect[] = [{ x: 20, y: 40, width: 236, height: 300 }]): void {
  document.body.innerHTML = `
    <main id="grid">
      ${rects.map((_, index) => `
        <article>
          <div data-test-id="pinWrapper" id="pin-${index}">
            <a href="https://www.pinterest.com/pin/${index}/" id="link-${index}">
              <img id="media-${index}" src="https://i.pinimg.com/236x/${index}.jpg" />
            </a>
          </div>
        </article>
      `).join('')}
    </main>
  `;
  rects.forEach((rect, index) => {
    stubRect(document.querySelector(`#media-${index}`)!, rect);
  });
}

function pointerOver(target: Element): void {
  target.dispatchEvent(new Event('pointerover', { bubbles: true }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
}

describe('PinActionManager', () => {
  let manager: PinActionManager | null = null;
  let layerHost: HTMLElement;
  let layer: ShadowRoot;
  let ran: Array<{ action: MediaAction; pin: string }> = [];

  const build = (): PinActionManager => new PinActionManager(layer, async (action, pin) => {
    ran.push({ action, pin: pin.id });
  });

  const panel = (): HTMLElement => layer.querySelector<HTMLElement>('[data-ppp-ignore="true"]')!;
  const buttons = (): HTMLButtonElement[] =>
    Array.from(panel().shadowRoot!.querySelectorAll<HTMLButtonElement>('.ppp-action'));
  const isShown = (): boolean => panel().dataset.pppHidden === undefined;

  beforeEach(() => {
    ran = [];
    document.body.innerHTML = '';
    layerHost = document.createElement('div');
    layerHost.id = 'pinterest-plus-plus-root';
    layer = layerHost.attachShadow({ mode: 'open' });
    document.documentElement.append(layerHost);
  });

  afterEach(() => {
    manager?.stop();
    manager = null;
    layerHost.remove();
  });

  it('keeps its panel in the extension`s own layer, out of Pinterest`s DOM', () => {
    buildFeed();
    manager = build();
    manager.start();

    expect(panel().parentNode).toBe(layer);
    expect(document.querySelector('#pin-0')!.children.length).toBe(1);
    expect(panel().style.position).toBe('fixed');
    expect(isShown()).toBe(false);
  });

  it('places the panel in the media`s bottom-left corner on hover', () => {
    buildFeed();
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    pointerOver(document.querySelector('#media-0')!);

    expect(isShown()).toBe(true);
    // The media runs 20,40 to 256,340: inset 12 from its left and bottom edges.
    expect(panel().style.left).toBe('32px');
    expect(panel().style.top).toBe('296px');
  });

  it('keeps the panel on screen when the pin runs past the window', () => {
    buildFeed([{ x: 20, y: window.innerHeight - 200, width: 236, height: 500 }]);
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    pointerOver(document.querySelector('#media-0')!);

    expect(isShown()).toBe(true);
    expect(panel().style.top).toBe(`${window.innerHeight - 32 - 12}px`);
  });

  it('takes the panel away when the pointer leaves the pin', () => {
    buildFeed();
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    pointerOver(document.querySelector('#media-0')!);
    expect(isShown()).toBe(true);

    pointerOver(document.body);
    expect(isShown()).toBe(false);
  });

  it('stays put while the pointer is on the panel itself', () => {
    buildFeed();
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });
    pointerOver(document.querySelector('#media-0')!);

    // Events from inside the layer report the layer's host as their target.
    pointerOver(layerHost);

    expect(isShown()).toBe(true);
  });

  it('follows its pin as the page scrolls', async () => {
    buildFeed();
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });
    pointerOver(document.querySelector('#media-0')!);
    expect(panel().style.top).toBe('296px');

    stubRect(document.querySelector('#media-0')!, { x: 20, y: -60, width: 236, height: 300 });
    window.dispatchEvent(new Event('scroll'));
    // Repositioning is coalesced into the next frame, not done per event.
    await nextFrame();

    expect(panel().style.top).toBe('196px');
  });

  it('rises above a control of Pinterest`s that holds the same corner', () => {
    buildFeed();
    document.querySelector('#pin-0')!.insertAdjacentHTML(
      'beforeend',
      '<a href="https://example.com" id="visit">Visit site</a>',
    );
    // The pill sits exactly where the panel would: bottom-left of the media.
    stubRect(document.querySelector('#visit')!, { x: 32, y: 296, width: 120, height: 32 });
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    pointerOver(document.querySelector('#media-0')!);

    // Cleared by the overlap plus the gap: 296 - (328 - 296 + 8).
    expect(panel().style.top).toBe('256px');
  });

  it('rises above a control Pinterest renders only after the hover began', async () => {
    buildFeed();
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });
    pointerOver(document.querySelector('#media-0')!);
    expect(panel().style.top).toBe('296px');

    // Pinterest's own hover handler runs after this capture listener.
    document.querySelector('#pin-0')!.insertAdjacentHTML(
      'beforeend',
      '<a href="https://example.com" id="visit">Visit site</a>',
    );
    stubRect(document.querySelector('#visit')!, { x: 32, y: 296, width: 120, height: 32 });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    await nextFrame();

    expect(panel().style.top).toBe('256px');
  });

  it('anchors to the pin`s picture, not a smaller image ahead of it', () => {
    buildFeed();
    document.querySelector('#link-0')!.insertAdjacentHTML(
      'afterbegin',
      '<img id="avatar" src="https://i.pinimg.com/30x30/avatar.jpg" />',
    );
    stubRect(document.querySelector('#avatar')!, { x: 20, y: 350, width: 24, height: 24 });
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    pointerOver(document.querySelector('#media-0')!);

    expect(isShown()).toBe(true);
    expect(panel().style.top).toBe('296px');
  });

  it('ignores the link the whole tile is wrapped in', () => {
    buildFeed();
    // The tile's own link covers the media, corner included.
    stubRect(document.querySelector('#link-0')!, { x: 20, y: 40, width: 236, height: 300 });
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    pointerOver(document.querySelector('#media-0')!);

    expect(panel().style.top).toBe('296px');
  });

  it('ignores a control of Pinterest`s at the other end of the same line', () => {
    buildFeed();
    document.querySelector('#pin-0')!.insertAdjacentHTML(
      'beforeend',
      '<button id="more" aria-label="More options"></button>',
    );
    stubRect(document.querySelector('#more')!, { x: 204, y: 288, width: 40, height: 40 });
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    pointerOver(document.querySelector('#media-0')!);

    expect(panel().style.top).toBe('296px');
  });

  it('offers no panel on a tile too small to hold one', () => {
    buildFeed([{ x: 20, y: 40, width: 60, height: 60 }]);
    manager = build();
    manager.start();

    pointerOver(document.querySelector('#media-0')!);

    expect(isShown()).toBe(false);
  });

  it('runs the action against the pin the panel is serving', () => {
    buildFeed([
      { x: 20, y: 40, width: 236, height: 300 },
      { x: 280, y: 40, width: 236, height: 300 },
    ]);
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    pointerOver(document.querySelector('#media-0')!);
    buttons()[0]!.click();
    pointerOver(document.querySelector('#media-1')!);
    buttons()[1]!.click();

    expect(ran).toEqual([
      { action: 'copy', pin: 'pin-0' },
      { action: 'download', pin: 'pin-1' },
    ]);
  });

  it('runs nothing once the pin it was serving is gone', () => {
    buildFeed();
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });
    pointerOver(document.querySelector('#media-0')!);

    document.querySelector('#pin-0')!.remove();
    buttons()[0]!.click();

    expect(ran).toEqual([]);
  });

  it('reveals the panel for a keyboard user reaching a pin', () => {
    buildFeed();
    manager = build();
    manager.start();
    stubRect(panel(), { x: 0, y: 0, width: 68, height: 32 });

    document.querySelector('#link-0')!.dispatchEvent(new Event('focusin', { bubbles: true }));

    expect(isShown()).toBe(true);
  });

  it('takes its panel and its listeners away when stopped', () => {
    buildFeed();
    manager = build();
    manager.start();
    const stopped = panel();
    manager.stop();
    manager = null;

    expect(stopped.isConnected).toBe(false);
    expect(() => pointerOver(document.querySelector('#media-0')!)).not.toThrow();
    expect(layer.querySelector('[data-ppp-ignore="true"]')).toBeNull();
  });
});
