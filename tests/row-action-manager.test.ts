import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMediaActionHost, type HostAction } from '../shared/media-action-host';
import { RowActionManager } from '../shared/row-action-manager';

/**
 * A feed card as Pinterest renders it for a signed-in user (measured on the
 * live home feed): the image and its hover overlay in `pinWrapper`, and beside
 * it a footer whose single-line flex row holds the title and the menu.
 */
function card(index: number, { rowStyle = 'display:flex', overlayMenu = false } = {}): string {
  return `
    <div role="listitem" data-grid-item="true" id="card-${index}">
      <div data-test-id="pin">
        <div role="group" aria-label="Pin card">
          <div data-test-id="pin-missing-alt-text">
            <div data-test-id="pinWrapper" id="pin-${index}">
              <a href="/pin/${index}/"><img src="https://i.pinimg.com/236x/${index}.jpg" /></a>
              ${overlayMenu ? `<button data-test-id="more-actions-button" id="overlay-menu-${index}"></button>` : ''}
            </div>
            <div>
              <div data-test-id="pointer-events-wrapper">
                <div class="row" id="row-${index}" style="${rowStyle}">
                  <div class="title" style="flex:1 1 auto;min-width:0"><h2>Pin ${index}</h2></div>
                  <div class="menu-column" id="menu-column-${index}">
                    <div>
                      <div aria-label="More actions">
                        <button data-test-id="more-actions-button" aria-label="More actions" id="menu-${index}"></button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function buildFeed(count: number, options?: Parameters<typeof card>[1]): void {
  document.body.innerHTML = `<main id="grid">${Array.from({ length: count }, (_, index) => card(index, options)).join('')}</main>`;
}

function hostIn(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#row-${index} > [data-ppp-row-host]`);
}

function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe('RowActionManager', () => {
  let manager: RowActionManager | null = null;
  let ran: Array<{ action: HostAction; pin: string | null }> = [];
  let sizes: number[] = [];

  const build = () => new RowActionManager((resolvePin, size) => {
    sizes.push(size);
    return createMediaActionHost('row', async (action) => {
      ran.push({ action, pin: resolvePin()?.id ?? null });
    }, size);
  });

  beforeEach(() => {
    ran = [];
    sizes = [];
  });

  afterEach(() => {
    manager?.stop();
    manager = null;
    document.body.innerHTML = '';
  });

  it('puts the pair just before each card`s three-dot menu, inside its footer row', () => {
    buildFeed(3);
    manager = build();
    manager.start();

    for (const index of [0, 1, 2]) {
      const host = hostIn(index)!;
      expect(host).not.toBeNull();
      expect(host.nextElementSibling!.id).toBe(`menu-column-${index}`);
      expect(host.previousElementSibling!.className).toBe('title');
    }
  });

  it('sizes the pair to the menu in layout pixels, so the footer keeps its height', () => {
    buildFeed(1);
    // Pinterest scales cards with a transform; offsetHeight is the unscaled size.
    Object.defineProperty(document.querySelector('#menu-0'), 'offsetHeight', { value: 24 });
    manager = build();
    manager.start();

    expect(sizes).toEqual([24]);
    expect(hostIn(0)!.style.height).toBe('24px');
    expect(hostIn(0)!.style.flex).toBe('0 0 auto');
  });

  it('leaves alone a menu inside the image, which belongs to the hover overlay', () => {
    buildFeed(1, { overlayMenu: true });
    manager = build();
    manager.start();

    expect(document.querySelectorAll('[data-ppp-row-host]')).toHaveLength(1);
    expect(document.querySelector('#pin-0 [data-ppp-row-host]')).toBeNull();
  });

  it('does not touch a menu outside the grid, such as the close-up`s own', () => {
    document.body.innerHTML = `
      <section id="closeup">
        <div class="row" style="display:flex">
          <div class="title">Pin</div>
          <div><button data-test-id="more-actions-button" id="closeup-menu"></button></div>
        </div>
      </section>`;
    manager = build();
    manager.start();

    expect(document.querySelector('[data-ppp-row-host]')).toBeNull();
  });

  it('stays out of a footer that is not a single-line flex row', () => {
    buildFeed(2, { rowStyle: 'display:flex;flex-wrap:wrap' });
    document.querySelector<HTMLElement>('#row-1')!.style.cssText = 'display:block';
    manager = build();
    manager.start();

    expect(document.querySelector('[data-ppp-row-host]')).toBeNull();
    expect(manager.serves(document.querySelector<HTMLElement>('#pin-0')!)).toBe(false);
  });

  it('decorates a card the feed mounts later, such as one scrolled back into view', async () => {
    buildFeed(1);
    manager = build();
    manager.start();

    document.querySelector('#grid')!.insertAdjacentHTML('beforeend', card(7));
    await settle();

    expect(hostIn(7)).not.toBeNull();
  });

  it('puts back a pair that a re-render took out, but does not fight one that keeps doing it', async () => {
    buildFeed(1);
    manager = build();
    manager.start();

    for (let round = 0; round < 3; round += 1) {
      hostIn(0)!.remove();
      await settle();
      expect(hostIn(0)).not.toBeNull();
    }
    hostIn(0)!.remove();
    await settle();

    expect(hostIn(0)).toBeNull();
    expect(manager.serves(document.querySelector<HTMLElement>('#pin-0')!)).toBe(false);
  });

  it('never adds a second pair to the same row', async () => {
    buildFeed(1);
    manager = build();
    manager.start();
    manager.stop();
    manager.start();
    // An unrelated change inside the card reports the menu's subtree again.
    document.querySelector('#menu-column-0 > div')!.append(document.createElement('span'));
    await settle();

    expect(document.querySelectorAll('#row-0 > [data-ppp-row-host]')).toHaveLength(1);
  });

  it('tells the hover panel which pins it serves', () => {
    buildFeed(2, { rowStyle: 'display:flex' });
    document.querySelector<HTMLElement>('#row-1')!.style.cssText = 'display:block';
    manager = build();
    manager.start();

    expect(manager.serves(document.querySelector<HTMLElement>('#pin-0')!)).toBe(true);
    expect(manager.serves(document.querySelector<HTMLElement>('#pin-1')!)).toBe(false);
  });

  it('acts on the card`s pin as it is when the button is pressed', () => {
    buildFeed(2);
    manager = build();
    manager.start();

    hostIn(1)!.shadowRoot!.querySelectorAll<HTMLButtonElement>('.ppp-action')[1]!.click();

    expect(ran).toEqual([{ action: 'download', pin: 'pin-1' }]);
  });

  it('takes every pair away when switched off', () => {
    buildFeed(2);
    manager = build();
    manager.start();
    manager.stop();

    expect(document.querySelector('[data-ppp-row-host]')).toBeNull();
    expect(manager.serves(document.querySelector<HTMLElement>('#pin-0')!)).toBe(false);
  });
});
