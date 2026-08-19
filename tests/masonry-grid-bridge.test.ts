import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRID_SET_WIDTH_EVENT,
  GRID_STATUS_EVENT,
  type GridSetWidthDetail,
  type GridStatusDetail,
} from '../shared/grid-bridge-events';
import {
  MasonryGridBridge,
  type MasonryInstance,
  type MasonryPosition,
  calculateEffectiveLayout,
  findMasonryInstance,
  findPinGridRoots,
} from '../shared/masonry-grid-bridge';
import { DEFAULT_TILE_WIDTH, MIN_TILE_WIDTH } from '../shared/settings';

/** Half of the 900px grid this fixture reports: two full-width columns. */
const LARGE_TILE_WIDTH = 440;

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

interface Fixture {
  root: HTMLElement;
  instance: MasonryInstance;
  originalRender: ReturnType<typeof vi.fn>;
  getReflowCount(): number;
  getScrollTop(): number;
}

function createFixture(compatible = true): Fixture {
  document.body.innerHTML = `
    <main id="wrapper">
      <div id="grid" role="list">
        ${Array.from({ length: 6 }, (_, index) => `
          <article data-grid-item data-top="${Math.floor(index / 3) * 320}" data-left="${(index % 3) * 250}">
            <div data-grid-item-idx="${index}">
              <div data-test-id="pinWrapper" id="pin-${index}"></div>
            </div>
          </article>
        `).join('')}
      </div>
    </main>
  `;
  const wrapper = document.querySelector<HTMLElement>('#wrapper')!;
  const root = document.querySelector<HTMLElement>('#grid')!;
  let rootHeight = 640;
  let scrollTop = 0;
  vi.spyOn(window, 'scrollTo').mockImplementation(((_x: number, y: number) => {
    scrollTop = y;
  }) as typeof window.scrollTo);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === wrapper || this === root) return domRect(0, 100 - scrollTop, 900, rootHeight);
    const item = this.closest<HTMLElement>('[data-grid-item]');
    if (item) {
      const top = Number(item.dataset.top ?? 0);
      const left = Number(item.dataset.left ?? 0);
      const width = Number.parseFloat(item.style.width) || 236;
      return domRect(left, 100 + top - scrollTop, width, 300);
    }
    return domRect(0, 0, 100, 100);
  });

  const items = Array.from({ length: 6 }, (_, id) => ({ id }));
  const positions = new Map<unknown, MasonryPosition>();
  const positionStore = {
    get: (item: unknown) => positions.get(item),
    has: (item: unknown) => positions.has(item),
    set: (item: unknown, position: MasonryPosition) => positions.set(item, position),
    reset: () => positions.clear(),
  };
  const originalRender = vi.fn(() => null);
  let reflowCount = 0;
  const instance = {
    props: {
      columnWidth: 221,
      layout: 'serverRenderedFlexible',
      minCols: 2,
      virtualize: true,
      items,
    },
    state: {
      gutter: 16,
      hasPendingMeasurements: false,
      scrollTop: 0,
      width: 900,
    },
    positionStore,
    gridWrapper: wrapper,
    scrollContainer: { getScrollContainerRef: () => window },
    containerOffset: 100,
    maxHeight: rootHeight,
    render: originalRender,
    reflow() {
      reflowCount += 1;
      this.render();
      positions.clear();
      const width = this.props.columnWidth;
      const gutter = this.state.gutter ?? 0;
      const columns = Math.max(
        this.props.minCols,
        Math.max(1, Math.floor((this.state.width! + gutter) / (width + gutter))),
      );
      const gridItems = Array.from(root.querySelectorAll<HTMLElement>('[data-grid-item]'));
      gridItems.forEach((element, index) => {
        const top = Math.floor(index / columns) * 320;
        const left = (index % columns) * (width + gutter);
        element.dataset.top = String(top);
        element.dataset.left = String(left);
        element.style.width = `${width}px`;
        positionStore.set(items[index]!, { top, left, width, height: 300 });
      });
      rootHeight = Math.ceil(items.length / columns) * 320;
      root.style.height = `${rootHeight}px`;
      this.maxHeight = rootHeight;
      this.state.hasPendingMeasurements = false;
    },
  } satisfies MasonryInstance;

  instance.reflow();
  reflowCount = 0;
  const fiber = compatible
    ? { stateNode: root, return: { stateNode: {}, return: { stateNode: instance } } }
    : { stateNode: root, return: { stateNode: {}, return: { stateNode: { props: {} } } } };
  (root as unknown as Record<string, unknown>).__reactFiber$test = fiber;
  return {
    root,
    instance,
    originalRender,
    getReflowCount: () => reflowCount,
    getScrollTop: () => scrollTop,
  };
}

function dispatchWidth(requestId: number, width: number): void {
  const detail: GridSetWidthDetail = { requestId, width };
  document.dispatchEvent(new CustomEvent<GridSetWidthDetail>(GRID_SET_WIDTH_EVENT, { detail }));
}

function waitForStatus(requestId: number, state: GridStatusDetail['state']): Promise<GridStatusDetail> {
  return nextStatus((detail) => detail.requestId === requestId && detail.state === state);
}

function nextStatus(match: (detail: GridStatusDetail) => boolean): Promise<GridStatusDetail> {
  return new Promise((resolve) => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<GridStatusDetail>).detail;
      if (!match(detail)) return;
      document.removeEventListener(GRID_STATUS_EVENT, listener);
      resolve(detail);
    };
    document.addEventListener(GRID_STATUS_EVENT, listener);
  });
}

describe('MasonryGridBridge', () => {
  let bridge: MasonryGridBridge | null = null;

  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    bridge?.destroy();
    bridge = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('discovers only a compatible virtualized Pinterest Masonry instance', () => {
    const fixture = createFixture();

    expect(findPinGridRoots(document, 1_200)).toEqual([fixture.root]);
    expect(findMasonryInstance(fixture.root)).toBe(fixture.instance);

    fixture.instance.props.virtualize = false;
    expect(findMasonryInstance(fixture.root)).toBeNull();
  });

  it('calculates exact centered widths while lowering the minimum column count when needed', () => {
    expect(calculateEffectiveLayout(LARGE_TILE_WIDTH, 900, 16, 2)).toEqual({ width: 440, minCols: 2, columns: 2 });
    expect(calculateEffectiveLayout(LARGE_TILE_WIDTH, 400, 16, 2)).toEqual({ width: 400, minCols: 1, columns: 1 });
    expect(calculateEffectiveLayout(MIN_TILE_WIDTH, 900, 16, 2)).toEqual({ width: 160, minCols: 2, columns: 5 });
  });

  it('applies one native reflow, survives parent props replacement, and restores native layout', async () => {
    const fixture = createFixture();
    bridge = new MasonryGridBridge();
    bridge.start();

    const applied = waitForStatus(1, 'applied');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    expect(await applied).toMatchObject({
      effectiveWidth: LARGE_TILE_WIDTH,
      metrics: { availableWidth: 900, gutter: 16, columns: 2 },
    });

    expect(fixture.getReflowCount()).toBe(1);
    expect(fixture.instance.props.columnWidth).toBe(LARGE_TILE_WIDTH);
    expect(fixture.instance.props.layout).toBe('basicCentered');
    expect(fixture.root.querySelector<HTMLElement>('[data-grid-item]')!.style.width).toBe('440px');
    expect(document.documentElement.style.getPropertyValue('--ppp-grid-scale')).toBe('');

    fixture.instance.props = {
      columnWidth: 224,
      layout: 'serverRenderedFlexible',
      minCols: 3,
      virtualize: true,
      items: fixture.instance.props.items,
    };
    fixture.instance.render();
    expect(fixture.instance.props.columnWidth).toBe(LARGE_TILE_WIDTH);
    expect(fixture.instance.props.layout).toBe('basicCentered');

    window.scrollTo(0, 400);
    const anchor = fixture.root.querySelector<HTMLElement>('[data-grid-item-idx="2"]')!
      .closest<HTMLElement>('[data-grid-item]')!;
    const anchorTop = anchor.getBoundingClientRect().top;

    const reset = waitForStatus(2, 'applied');
    dispatchWidth(2, DEFAULT_TILE_WIDTH);
    await reset;

    expect(fixture.instance.render).toBe(fixture.originalRender);
    expect(fixture.instance.props.columnWidth).toBe(224);
    expect(fixture.instance.props.layout).toBe('serverRenderedFlexible');
    expect(fixture.instance.props.minCols).toBe(3);
    expect(fixture.getReflowCount()).toBe(2);
    expect(anchor.getBoundingClientRect().top).toBeCloseTo(anchorTop, 5);
    expect(fixture.getScrollTop()).toBe(80);
  });

  it('coalesces same-turn requests and reflows only the latest width', async () => {
    const fixture = createFixture();
    bridge = new MasonryGridBridge();
    bridge.start();

    const applied = waitForStatus(2, 'applied');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    dispatchWidth(2, MIN_TILE_WIDTH);
    await applied;

    expect(fixture.getReflowCount()).toBe(1);
    expect(fixture.instance.props.columnWidth).toBe(MIN_TILE_WIDTH);
  });

  it('waits for the virtualized anchor DOM to repopulate after a deep large-to-small reflow', async () => {
    const fixture = createFixture();
    bridge = new MasonryGridBridge();
    bridge.start();

    const largeApplied = waitForStatus(1, 'applied');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    await largeApplied;
    window.scrollTo(0, 400);
    const anchor = fixture.root.querySelector<HTMLElement>('[data-grid-item-idx="2"]')!
      .closest<HTMLElement>('[data-grid-item]')!;
    const anchorTop = anchor.getBoundingClientRect().top;

    const nativeReflow = fixture.instance.reflow.bind(fixture.instance);
    fixture.instance.reflow = () => {
      nativeReflow();
      const children = Array.from(fixture.root.children);
      for (const child of children) child.remove();
      window.setTimeout(() => fixture.root.append(...children), 80);
    };

    const smallApplied = waitForStatus(2, 'applied');
    dispatchWidth(2, MIN_TILE_WIDTH);
    await smallApplied;

    expect(anchor.isConnected).toBe(true);
    expect(anchor.getBoundingClientRect().top).toBeCloseTo(anchorTop, 5);
    expect(anchor.style.width).toBe('160px');
  });

  it('fails safely and stays on the native grid when the component contract is unavailable', async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false);
    bridge = new MasonryGridBridge();
    bridge.start();
    const status = waitForStatus(1, 'unsupported');

    dispatchWidth(1, LARGE_TILE_WIDTH);
    await vi.advanceTimersByTimeAsync(2_100);

    await expect(status).resolves.toMatchObject({
      requestId: 1,
      requestedWidth: LARGE_TILE_WIDTH,
      state: 'unsupported',
    });
    expect(fixture.root.querySelector<HTMLElement>('[data-grid-item]')!.style.width).toBe('221px');

    const secondStatus = waitForStatus(2, 'unsupported');
    dispatchWidth(2, MIN_TILE_WIDTH);
    await expect(secondStatus).resolves.toMatchObject({ requestId: 2, state: 'unsupported' });
  });

  it('reports fresh metrics when the grid width changes without a new request', async () => {
    const fixture = createFixture();
    bridge = new MasonryGridBridge();
    bridge.start();

    const applied = waitForStatus(1, 'applied');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    await applied;

    const rebounded = nextStatus((detail) => detail.metrics?.availableWidth === 1_400);
    fixture.instance.state.width = 1_400;
    window.dispatchEvent(new Event('resize'));

    await expect(rebounded).resolves.toMatchObject({
      state: 'applied',
      metrics: { availableWidth: 1_400, gutter: 16, columns: 3 },
    });
  });

  it('goes back to small tiles when huge tiles leave almost no pins mounted', async () => {
    const fixture = createFixture();
    bridge = new MasonryGridBridge();
    bridge.start();

    const applied = waitForStatus(1, 'applied');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    await applied;
    expect(fixture.instance.props.columnWidth).toBe(LARGE_TILE_WIDTH);

    // Two full-width columns are so tall that Pinterest's virtualization keeps
    // only a couple of pins in the DOM.
    for (const item of Array.from(fixture.root.querySelectorAll('[data-grid-item]')).slice(2)) {
      item.remove();
    }
    expect(document.querySelectorAll('[data-test-id="pinWrapper"]')).toHaveLength(2);

    const restored = waitForStatus(2, 'applied');
    dispatchWidth(2, MIN_TILE_WIDTH);
    await restored;

    expect(fixture.instance.props.columnWidth).toBe(MIN_TILE_WIDTH);
    expect(fixture.root.querySelector<HTMLElement>('[data-grid-item]')!.style.width).toBe('160px');
  });

  it('keeps resizing available when a reflow never reports that it settled', async () => {
    const fixture = createFixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Gestalt keeps measuring while images load after a large column change.
    const nativeReflow = fixture.instance.reflow.bind(fixture.instance);
    fixture.instance.reflow = () => {
      nativeReflow();
      fixture.instance.state.hasPendingMeasurements = true;
    };
    bridge = new MasonryGridBridge();
    bridge.start();

    const applied = waitForStatus(1, 'applied');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    await expect(applied).resolves.toMatchObject({ effectiveWidth: LARGE_TILE_WIDTH });

    // The slider must still be able to go back to a small tile size.
    const restored = waitForStatus(2, 'applied');
    dispatchWidth(2, MIN_TILE_WIDTH);
    await restored;

    expect(fixture.instance.props.columnWidth).toBe(MIN_TILE_WIDTH);
    expect(fixture.root.querySelector<HTMLElement>('[data-grid-item]')!.style.width).toBe('160px');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('ignores the grid growing taller and re-applies only when it gets wider', async () => {
    let notify: ((entries: ResizeObserverEntry[]) => void) | null = null;
    const observed: Element[] = [];
    class FakeResizeObserver {
      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        notify = callback;
      }

      observe(target: Element): void {
        observed.push(target);
      }

      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const fixture = createFixture();
    bridge = new MasonryGridBridge();
    bridge.start();

    const applied = waitForStatus(1, 'applied');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    await applied;
    expect(observed).toContain(fixture.instance.gridWrapper);

    const resize = (width: number, height: number): void => notify!([{
      target: fixture.instance.gridWrapper,
      contentRect: { width, height },
    } as unknown as ResizeObserverEntry]);

    let statuses = 0;
    const countStatus = (): void => { statuses += 1; };
    document.addEventListener(GRID_STATUS_EVENT, countStatus);
    resize(900, 12_000);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(statuses).toBe(0);
    document.removeEventListener(GRID_STATUS_EVENT, countStatus);

    fixture.instance.state.width = 1_400;
    const rebounded = nextStatus((detail) => detail.metrics?.availableWidth === 1_400);
    resize(1_400, 12_000);
    await expect(rebounded).resolves.toMatchObject({ metrics: { columns: 3 } });
  });

  it('resumes after a client-side navigation replaces an unsupported page', async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false);
    bridge = new MasonryGridBridge();
    bridge.start();

    const failed = waitForStatus(1, 'unsupported');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    await vi.advanceTimersByTimeAsync(2_100);
    await failed;

    // The same page keeps the latch: nothing about it has changed.
    const stillUnsupported = waitForStatus(2, 'unsupported');
    dispatchWidth(2, LARGE_TILE_WIDTH);
    await expect(stillUnsupported).resolves.toMatchObject({ state: 'unsupported' });

    vi.useRealTimers();
    window.history.pushState({}, '', '/search/pins/?q=cabins');
    (fixture.root as unknown as Record<string, unknown>).__reactFiber$test = {
      stateNode: fixture.root,
      return: { stateNode: {}, return: { stateNode: fixture.instance } },
    };

    const recovered = waitForStatus(3, 'applied');
    dispatchWidth(3, LARGE_TILE_WIDTH);
    await expect(recovered).resolves.toMatchObject({
      metrics: { availableWidth: 900, columns: 2 },
    });
    expect(fixture.instance.props.columnWidth).toBe(LARGE_TILE_WIDTH);
  });

  it('stops retrying an incompatible build after the recovery cap', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createFixture(false);
    bridge = new MasonryGridBridge();
    bridge.start();

    dispatchWidth(1, LARGE_TILE_WIDTH);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(warn).toHaveBeenCalledTimes(1);

    // Three navigations are retried; the fourth is refused.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      window.history.pushState({}, '', `/search/pins/?q=attempt-${attempt}`);
      dispatchWidth(attempt + 2, LARGE_TILE_WIDTH);
      await vi.advanceTimersByTimeAsync(2_100);
    }

    expect(warn).toHaveBeenCalledTimes(4);
  });
});
