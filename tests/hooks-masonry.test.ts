import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRID_SET_WIDTH_EVENT,
  GRID_STATUS_EVENT,
  type GridSetWidthDetail,
  type GridStatusDetail,
} from '../shared/grid-bridge-events';
import { MasonryGridBridge, type MasonryPosition, findMasonryInstance } from '../shared/masonry-grid-bridge';
import {
  HooksMasonryInstance,
  findPositionStore,
  isHooksMasonryFiber,
} from '../shared/hooks-masonry';

/** Half of the 900px grid this fixture reports: two full-width columns. */
const LARGE_TILE_WIDTH = 440;
const NATIVE_COLUMN_WIDTH = 221;
const GUTTER = 16;

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, top: y, left: x, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) };
}

interface RenderedProps {
  columnWidth: number;
  layout: string;
  minCols: number;
}

interface HooksFixture {
  root: HTMLElement;
  wrapper: HTMLElement;
  fiber: Record<string, unknown>;
  component: (props: Record<string, unknown>) => unknown;
  lastRendered(): RenderedProps | null;
  renderCount(): number;
}

interface FixtureOptions {
  /** Wrap the component the way `forwardRef`/`memo` do in the shipped bundle. */
  container?: 'plain' | 'forwardRef' | 'memo';
  /** Whether Pinterest passes a ref carrying the imperative `reflow` handle. */
  imperativeHandle?: boolean;
}

/**
 * A function-component Masonry: no `stateNode`, layout props on
 * `memoizedProps`, and the stores hidden in the hook chain — the shape the
 * class bridge could never see.
 */
function createHooksFixture(options: FixtureOptions = {}): HooksFixture {
  const { container = 'plain', imperativeHandle = true } = options;
  document.body.innerHTML = `
    <main id="wrapper">
      <div id="grid" role="list">
        ${Array.from({ length: 6 }, (_, index) => `
          <article data-grid-item data-top="0" data-left="0">
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
      const width = Number.parseFloat(item.style.width) || NATIVE_COLUMN_WIDTH;
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
  // Shape-identical to the position store, but answers with heights. The
  // adapter must not mistake this one for the layout it anchors against.
  const heights = new Map<unknown, number>(items.map((item) => [item, 300]));
  const measurementStore = {
    get: (item: unknown) => heights.get(item),
    has: (item: unknown) => heights.has(item),
    set: (item: unknown, height: number) => heights.set(item, height),
    reset: () => heights.clear(),
  };

  let rendered: RenderedProps | null = null;
  let renders = 0;
  const component = (props: Record<string, unknown>): unknown => {
    renders += 1;
    const columnWidth = props.columnWidth as number;
    const minCols = props.minCols as number;
    rendered = { columnWidth, layout: props.layout as string, minCols };
    const columns = Math.max(
      minCols,
      Math.max(1, Math.floor((900 + GUTTER) / (columnWidth + GUTTER))),
    );
    positions.clear();
    Array.from(root.querySelectorAll<HTMLElement>('[data-grid-item]')).forEach((element, index) => {
      const top = Math.floor(index / columns) * 320;
      const left = (index % columns) * (columnWidth + GUTTER);
      element.dataset.top = String(top);
      element.dataset.left = String(left);
      element.style.width = `${columnWidth}px`;
      positionStore.set(items[index]!, { top, left, width: columnWidth, height: 300 });
    });
    rootHeight = Math.ceil(items.length / columns) * 320;
    root.style.height = `${rootHeight}px`;
    return null;
  };

  const memoizedProps = {
    columnWidth: NATIVE_COLUMN_WIDTH,
    layout: 'serverRenderedFlexible',
    minCols: 2,
    virtualize: true,
    items,
  };

  const type = container === 'plain'
    ? component
    : container === 'forwardRef'
      ? { $$typeof: Symbol.for('react.forward_ref'), render: component }
      : { $$typeof: Symbol.for('react.memo'), type: component };

  const fiber: Record<string, unknown> = {
    stateNode: null,
    type,
    memoizedProps,
    child: { stateNode: wrapper },
    // `useState`/`useRef` slots, in the order a Masonry keeps them.
    memoizedState: {
      memoizedState: [measurementStore, () => {}],
      next: { memoizedState: { current: positionStore }, next: null },
    },
  };
  if (imperativeHandle) {
    fiber.ref = {
      current: {
        state: { width: 900 },
        handleResize: () => {},
        reflow: () => {
          const current = fiber.type as ((props: Record<string, unknown>) => unknown) |
            { render?: (props: Record<string, unknown>) => unknown; type?: (props: Record<string, unknown>) => unknown };
          const render = typeof current === 'function' ? current : (current.render ?? current.type)!;
          render(fiber.memoizedProps as Record<string, unknown>);
        },
      },
    };
  }
  fiber.alternate = { ...fiber, alternate: fiber };

  (root as unknown as Record<string, unknown>).__reactFiber$test = { stateNode: root, return: fiber };
  // Lay the grid out once, the way a mounted Pinterest grid already is.
  component(memoizedProps);

  return {
    root,
    wrapper,
    fiber,
    component,
    lastRendered: () => rendered,
    renderCount: () => renders,
  };
}

function dispatchWidth(requestId: number, width: number): void {
  const detail: GridSetWidthDetail = { requestId, width };
  document.dispatchEvent(new CustomEvent<GridSetWidthDetail>(GRID_SET_WIDTH_EVENT, { detail }));
}

function waitForStatus(requestId: number, state: GridStatusDetail['state']): Promise<GridStatusDetail> {
  return new Promise((resolve) => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<GridStatusDetail>).detail;
      if (detail.requestId !== requestId || detail.state !== state) return;
      document.removeEventListener(GRID_STATUS_EVENT, listener);
      resolve(detail);
    };
    document.addEventListener(GRID_STATUS_EVENT, listener);
  });
}

describe('hooks-based Masonry', () => {
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

  it('recognises a function-component Masonry and ignores class and host fibers', () => {
    const fixture = createHooksFixture();

    expect(isHooksMasonryFiber(fixture.fiber)).toBe(true);
    expect(isHooksMasonryFiber({ stateNode: fixture.root, type: 'div' })).toBe(false);
    // A class Masonry already has an instance the bridge patches directly.
    expect(isHooksMasonryFiber({
      stateNode: { props: {} },
      type: fixture.component,
      memoizedProps: fixture.fiber.memoizedProps,
    })).toBe(false);
  });

  it('picks the position store over the shape-identical measurement store', () => {
    const fixture = createHooksFixture();
    const items = (fixture.fiber.memoizedProps as { items: unknown[] }).items;

    const store = findPositionStore(fixture.fiber, items);
    expect(store).not.toBeNull();
    expect(store!.get(items[0])).toMatchObject({ top: 0, left: 0, width: NATIVE_COLUMN_WIDTH });

    // With no laid-out positions to probe, no store is confidently identified.
    expect(findPositionStore({ memoizedState: null }, items)).toBeNull();
  });

  it('discovers an adapter through the fiber walk when no class instance exists', () => {
    const fixture = createHooksFixture();
    const instance = findMasonryInstance(fixture.root);

    expect(instance).toBeInstanceOf(HooksMasonryInstance);
    expect(instance!.gridWrapper).toBe(fixture.wrapper);
    expect(instance!.state.width).toBe(900);
    // The same mounted grid must resolve to one adapter, or it would be
    // patched twice and restored once.
    expect(findMasonryInstance(fixture.root)).toBe(instance);
  });

  it('injects overridden layout props on render and restores the component', () => {
    const fixture = createHooksFixture();
    const instance = findMasonryInstance(fixture.root) as HooksMasonryInstance;
    const originalType = fixture.fiber.type;

    instance.install({ onContractBroken: () => {}, onNativeProps: () => {} });
    instance.props.columnWidth = LARGE_TILE_WIDTH;
    instance.props.layout = 'basicCentered';
    instance.props.minCols = 2;
    instance.reflow();

    expect(fixture.lastRendered()).toEqual({
      columnWidth: LARGE_TILE_WIDTH,
      layout: 'basicCentered',
      minCols: 2,
    });

    instance.uninstall();
    instance.reflow();
    expect(fixture.lastRendered()).toEqual({
      columnWidth: NATIVE_COLUMN_WIDTH,
      layout: 'serverRenderedFlexible',
      minCols: 2,
    });
    expect(fixture.fiber.type).toBe(originalType);
  });

  it.each(['forwardRef', 'memo'] as const)('clones a %s container instead of mutating it', (container) => {
    const fixture = createHooksFixture({ container });
    const shared = fixture.fiber.type as Record<string, unknown>;
    const instance = findMasonryInstance(fixture.root) as HooksMasonryInstance;

    instance.install({ onContractBroken: () => {}, onNativeProps: () => {} });
    // Every other grid on the page renders through this same object.
    expect(shared.render ?? shared.type).toBe(fixture.component);
    expect(fixture.fiber.type).not.toBe(shared);

    instance.reflow();
    expect(fixture.lastRendered()?.columnWidth).toBe(NATIVE_COLUMN_WIDTH);

    instance.props.columnWidth = LARGE_TILE_WIDTH;
    instance.reflow();
    expect(fixture.lastRendered()?.columnWidth).toBe(LARGE_TILE_WIDTH);

    instance.uninstall();
    expect((fixture.fiber.type as Record<string, unknown>).render ??
      (fixture.fiber.type as Record<string, unknown>).type).toBe(fixture.component);
  });

  it('reports a broken contract when Pinterest renders unpatchable props', () => {
    const fixture = createHooksFixture();
    const instance = findMasonryInstance(fixture.root) as HooksMasonryInstance;
    const reasons: string[] = [];

    instance.install({
      onContractBroken: (reason) => reasons.push(reason),
      onNativeProps: () => {},
    });
    const render = fixture.fiber.type as (props: Record<string, unknown>) => unknown;
    render(Object.freeze({ ...(fixture.fiber.memoizedProps as object) }));

    expect(reasons).toHaveLength(1);
  });

  it('falls back to a window resize when no imperative handle is passed', () => {
    const fixture = createHooksFixture({ imperativeHandle: false });
    const instance = findMasonryInstance(fixture.root) as HooksMasonryInstance;
    const resized = vi.fn();
    window.addEventListener('resize', resized);

    instance.install({ onContractBroken: () => {}, onNativeProps: () => {} });
    instance.reflow();

    expect(resized).toHaveBeenCalledTimes(1);
    window.removeEventListener('resize', resized);
  });

  it('resizes a search-style grid end to end and restores the native layout', async () => {
    const fixture = createHooksFixture();
    bridge = new MasonryGridBridge();
    bridge.start();

    const applied = waitForStatus(1, 'applied');
    dispatchWidth(1, LARGE_TILE_WIDTH);
    expect(await applied).toMatchObject({
      effectiveWidth: LARGE_TILE_WIDTH,
      metrics: { availableWidth: 900, gutter: 16, columns: 2 },
    });
    expect(fixture.lastRendered()).toMatchObject({
      columnWidth: LARGE_TILE_WIDTH,
      layout: 'basicCentered',
    });

    const restored = waitForStatus(2, 'applied');
    dispatchWidth(2, 236);
    await restored;
    expect(fixture.lastRendered()?.columnWidth).toBe(NATIVE_COLUMN_WIDTH);
    expect(fixture.fiber.type).toBe(fixture.component);
  });
});
