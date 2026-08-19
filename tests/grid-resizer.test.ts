import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GridResizer } from '../shared/grid-resizer';
import { GRID_DESTROY_EVENT, GRID_SET_WIDTH_EVENT, type GridSetWidthDetail } from '../shared/grid-bridge-events';
import { DEFAULT_TILE_WIDTH } from '../shared/settings';

/** Half of the 900px grid used by this fixture: two full-width columns. */
const LARGE_TILE_WIDTH = 440;

function gridMarkup(id = 'grid'): string {
  return `
    <main id="${id}" style="height: 2400px">
      ${Array.from({ length: 6 }, (_, index) => `
        <article id="item-${index}" style="position: absolute; transform: translate(${index * 20}px, ${index * 80}px); height: 300px">
          <div class="bridge"><div data-test-id="pinWrapper" id="pin-${index}"></div></div>
        </article>
      `).join('')}
    </main>
  `;
}

describe('GridResizer', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.innerHTML = gridMarkup();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.id === 'grid' || this.id === 'replacement-grid' ? 900 : 200;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 2400, width, height: 2400, toJSON: () => ({}) };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('discovers the grid without taking over Pinterest tile geometry', () => {
    const resizer = new GridResizer(DEFAULT_TILE_WIDTH);
    resizer.start();

    const root = document.querySelector<HTMLElement>('#grid')!;
    const item = document.querySelector<HTMLElement>('#item-2')!;
    const bridge = item.querySelector<HTMLElement>('.bridge')!;
    expect(root.dataset.pppGridRoot).toBe('true');
    expect(root.dataset.pppGridResized).toBeUndefined();
    expect(root.style.height).toBe('2400px');
    expect(item.style.position).toBe('absolute');
    expect(item.style.transform).toContain('translate');
    expect(item.style.height).toBe('300px');
    expect(item.dataset.pppGridItem).toBeUndefined();
    expect(bridge.dataset.pppGridBridge).toBeUndefined();
    expect(document.querySelector<HTMLElement>('#pin-2')!.dataset.pppPinContent).toBeUndefined();

    resizer.stop();
  });

  it('commits width changes to the main-world bridge without styling the page', () => {
    const requests: GridSetWidthDetail[] = [];
    document.addEventListener(GRID_SET_WIDTH_EVENT, ((event: CustomEvent<GridSetWidthDetail>) => {
      requests.push(event.detail);
    }) as EventListener);
    const resizer = new GridResizer(DEFAULT_TILE_WIDTH);
    resizer.start();
    const root = document.querySelector<HTMLElement>('#grid')!;

    resizer.applyWidth(LARGE_TILE_WIDTH);
    expect(root.dataset.pppGridResized).toBe('true');
    expect(requests).toEqual([
      { requestId: 1, width: DEFAULT_TILE_WIDTH },
      { requestId: 2, width: LARGE_TILE_WIDTH },
    ]);
    expect(document.documentElement.getAttribute('style')).toBeNull();

    resizer.applyWidth(DEFAULT_TILE_WIDTH);
    expect(root.dataset.pppGridResized).toBeUndefined();
    expect(requests.at(-1)).toEqual({ requestId: 3, width: DEFAULT_TILE_WIDTH });

    let destroyed = false;
    document.addEventListener(GRID_DESTROY_EVENT, () => { destroyed = true; }, { once: true });
    resizer.stop();
    expect(root.dataset.pppGridRoot).toBeUndefined();
    expect(destroyed).toBe(true);
  });

  it('does not rewrite virtualized tiles added while scrolling', async () => {
    const resizer = new GridResizer(LARGE_TILE_WIDTH);
    resizer.start();
    const root = document.querySelector<HTMLElement>('#grid')!;
    const item = document.createElement('article');
    item.style.cssText = 'position:absolute;transform:translate(40px, 1800px);height:260px';
    item.innerHTML = '<div class="bridge"><div data-test-id="pinWrapper" id="pin-new"></div></div>';
    root.append(item);
    await Promise.resolve();

    expect(item.style.position).toBe('absolute');
    expect(item.style.transform).toContain('translate');
    expect(item.style.height).toBe('260px');
    expect(item.dataset.pppGridItem).toBeUndefined();
    expect(item.querySelector<HTMLElement>('.bridge')!.dataset.pppGridBridge).toBeUndefined();
    expect(item.querySelector<HTMLElement>('#pin-new')!.dataset.pppPinContent).toBeUndefined();

    resizer.stop();
  });
});
