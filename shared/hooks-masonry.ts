import type { MasonryInstance, MasonryPosition, MasonryProps, NativeProps } from './masonry-grid-bridge';

/**
 * Pinterest ships more than one Masonry implementation. The home feed renders
 * the class component the bridge patches directly; search, pin close-up, and
 * profile feeds render a hooks-based Masonry whose fiber carries no
 * `stateNode`, so there is no instance object to patch and grid resizing
 * reported the whole page as unsupported.
 *
 * This module adapts such a fiber to the same `MasonryInstance` surface the
 * bridge already drives. Layout props are injected by replacing the fiber's
 * component with a wrapper; React copies `type` onto every work-in-progress
 * fiber, so the override survives the parent re-rendering with fresh props the
 * same way the class bridge's `render` wrapper does.
 */

type Component = (this: unknown, props: Record<string, unknown>, ...rest: unknown[]) => unknown;

interface WrappedComponent extends Component {
  pppOriginal?: Component;
}

/** The subset of React's fiber and hook nodes this adapter reads. */
export interface MasonryFiber {
  type?: unknown;
  ref?: unknown;
  child?: MasonryFiber | null | undefined;
  return?: MasonryFiber | null | undefined;
  alternate?: MasonryFiber | null | undefined;
  stateNode?: unknown;
  memoizedProps?: unknown;
  memoizedState?: unknown;
}

interface HookNode {
  memoizedState?: unknown;
  next?: HookNode | null | undefined;
}

interface ImperativeHandle {
  reflow?: unknown;
  handleResize?: unknown;
  state?: { width?: unknown } | undefined;
}

/** Hooks a Masonry keeps between renders; probed rather than counted. */
const MAX_SCANNED_HOOKS = 96;
/** Items sampled when deciding which duck-typed store holds positions. */
const POSITION_PROBE_ITEMS = 8;
const MAX_CHILD_DESCENT = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isFunction(value: unknown): value is Component {
  return typeof value === 'function';
}

function isNiladic(value: unknown): value is (this: unknown) => void {
  return typeof value === 'function';
}

/**
 * Masonry's own props, regardless of which implementation renders them. The
 * bridge only ever overrides these three, so these are what must be present.
 */
export function isMasonryLikeProps(value: unknown): value is MasonryProps {
  if (!isRecord(value)) return false;
  return typeof value.columnWidth === 'number' && Number.isFinite(value.columnWidth) &&
    typeof value.layout === 'string' &&
    typeof value.minCols === 'number' && Number.isFinite(value.minCols) && value.minCols >= 1 &&
    Array.isArray(value.items) &&
    !Object.isFrozen(value);
}

/**
 * A fiber rendered by a function, a `forwardRef`, or a `memo` wrapper around
 * either. Class components are excluded: those already have a `stateNode` the
 * bridge patches directly, and patching them twice would fight itself.
 */
export function isHooksMasonryFiber(fiber: MasonryFiber): boolean {
  if (isRecord(fiber.stateNode) || isFunction(fiber.stateNode)) return false;
  return componentOf(fiber.type) !== null && isMasonryLikeProps(fiber.memoizedProps);
}

/**
 * Unwraps `memo`/`forwardRef` containers to the function React will call.
 * Returns the function together with a rebuilder that clones the container
 * around a replacement, so an override never mutates the shared component
 * object that every other grid on the page also renders.
 */
function componentOf(type: unknown): { render: Component; rebuild: (next: Component) => unknown } | null {
  if (isFunction(type)) return { render: type, rebuild: (next) => next };
  if (!isRecord(type)) return null;

  if (isFunction(type.render)) {
    const render = type.render;
    return { render, rebuild: (next) => ({ ...type, render: next }) };
  }
  // `memo(Component)` and `memo(forwardRef(Component))`.
  if (type.type !== undefined) {
    const inner = componentOf(type.type);
    if (inner) return { render: inner.render, rebuild: (next) => ({ ...type, type: inner.rebuild(next) }) };
  }
  return null;
}

function originalOf(type: unknown): Component | null {
  const component = componentOf(type);
  if (!component) return null;
  return (component.render as WrappedComponent).pppOriginal ?? null;
}

export function readNativeMasonryProps(props: unknown): NativeProps | null {
  if (!isMasonryLikeProps(props)) return null;
  return { columnWidth: props.columnWidth, layout: props.layout, minCols: props.minCols };
}

function isPositionLike(value: unknown): value is MasonryPosition {
  return isRecord(value) &&
    typeof value.top === 'number' && typeof value.left === 'number' &&
    typeof value.width === 'number' && typeof value.height === 'number';
}

function isStoreLike(value: unknown): value is { get(item: unknown): unknown; has(item: unknown): boolean; reset(): void } {
  return isRecord(value) && isFunction(value.get) && isFunction(value.has) && isFunction(value.reset);
}

/**
 * Masonry keeps a measurement store and a position store side by side, and the
 * two are shape-identical. Only the position store answers with a rectangle, so
 * the live items decide which one this is. Without a confident match the
 * adapter reports no store and the bridge skips scroll anchoring rather than
 * resizing against measurements.
 */
export function findPositionStore(
  fiber: MasonryFiber,
  items: ReadonlyArray<unknown>,
): MasonryInstance['positionStore'] | null {
  const probes = items.slice(0, POSITION_PROBE_ITEMS);
  if (probes.length === 0) return null;

  const candidates: unknown[] = [];
  for (const source of [fiber, fiber.alternate]) {
    let hook = source?.memoizedState as HookNode | null | undefined;
    for (let depth = 0; hook && depth < MAX_SCANNED_HOOKS; depth += 1, hook = hook.next) {
      const state = hook.memoizedState;
      candidates.push(state);
      // `useState` keeps the value in a tuple slot; `useRef` behind `current`.
      if (Array.isArray(state)) candidates.push(state[0]);
      if (isRecord(state)) candidates.push(state.current);
    }
  }

  for (const candidate of candidates) {
    if (!isStoreLike(candidate)) continue;
    const answers = probes.filter((item) => candidate.has(item)).map((item) => candidate.get(item));
    if (answers.length > 0 && answers.every(isPositionLike)) {
      return candidate as MasonryInstance['positionStore'];
    }
  }
  return null;
}

function imperativeHandle(fiber: MasonryFiber): ImperativeHandle | null {
  for (const source of [fiber, fiber.alternate]) {
    const ref = source?.ref;
    if (!isRecord(ref)) continue;
    const current = ref.current;
    if (isRecord(current) && (isFunction(current.reflow) || isFunction(current.handleResize))) {
      return current as ImperativeHandle;
    }
  }
  return null;
}

/** The element the Masonry component renders, used as its grid wrapper. */
function hostElementOf(fiber: MasonryFiber): HTMLElement | null {
  let child = fiber.child;
  for (let depth = 0; child && depth < MAX_CHILD_DESCENT; depth += 1, child = child.child) {
    if (child.stateNode instanceof HTMLElement) return child.stateNode;
  }
  return null;
}

function scrollContainerFor(element: HTMLElement, win: Window & typeof globalThis): HTMLElement | Window {
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== element.ownerDocument.body) {
    const overflow = win.getComputedStyle(ancestor).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && ancestor.scrollHeight > ancestor.clientHeight) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return win;
}

export interface HooksMasonryController {
  /** Told when Pinterest replaces the props with something unpatchable. */
  onContractBroken(reason: string): void;
  /** Told the component's own layout props, so a restore stays faithful. */
  onNativeProps(props: NativeProps): void;
}

/**
 * A hooks-rendered Masonry presented as the instance the bridge already knows
 * how to drive. `props` is the adapter's own mutable object: the bridge writes
 * overrides into it exactly as it does for a class instance, and the component
 * wrapper reads them back on every render.
 */
export class HooksMasonryInstance implements MasonryInstance {
  props: MasonryProps;
  maxHeight = 0;
  containerOffset = 0;
  positionStore: MasonryInstance['positionStore'];
  scrollContainer: MasonryInstance['scrollContainer'];
  /** False when no position store could be identified; anchoring is skipped. */
  readonly anchorable: boolean;

  private controller: HooksMasonryController | null = null;
  private installed = false;

  constructor(
    private fiber: MasonryFiber,
    public gridWrapper: HTMLElement,
    private win: Window & typeof globalThis,
  ) {
    const source = fiber.memoizedProps as MasonryProps;
    this.props = {
      columnWidth: source.columnWidth,
      layout: source.layout,
      minCols: source.minCols,
      virtualize: source.virtualize === true,
      items: source.items,
    };
    const store = findPositionStore(fiber, source.items);
    this.anchorable = store !== null;
    this.positionStore = store ?? {
      get: () => undefined,
      has: () => false,
      reset: () => {},
    };
    const container = scrollContainerFor(gridWrapper, win);
    this.scrollContainer = { getScrollContainerRef: () => container };
  }

  /** Keeps the adapter pointed at the fiber React is currently rendering. */
  adopt(fiber: MasonryFiber): void {
    this.fiber = fiber;
  }

  get state(): MasonryInstance['state'] {
    const handle = imperativeHandle(this.fiber);
    const reported = handle?.state?.width;
    const width = typeof reported === 'number' && Number.isFinite(reported) && reported > 0
      ? reported
      : this.gridWrapper.clientWidth;
    // The gutter is not exposed by this implementation; omitting it lets the
    // bridge fall back to Pinterest's own default rather than guess.
    return width > 0 ? { width } : {};
  }

  render(): unknown {
    return null;
  }

  reflow(): void {
    const handle = imperativeHandle(this.fiber);
    if (isNiladic(handle?.reflow)) {
      handle.reflow.call(handle);
      return;
    }
    if (isNiladic(handle?.handleResize)) {
      handle.handleResize.call(handle);
      return;
    }
    // Without an imperative handle the component's own resize listener is the
    // only re-render this adapter can ask for from outside React.
    this.win.dispatchEvent(new this.win.Event('resize'));
  }

  measureContainer(): void {
    const container = this.scrollContainer.getScrollContainerRef();
    const offset = container === this.win || !(container instanceof HTMLElement)
      ? this.win.scrollY
      : container.scrollTop;
    this.containerOffset = this.gridWrapper.getBoundingClientRect().top + offset;
  }

  install(controller: HooksMasonryController): boolean {
    if (this.installed) return true;
    const component = componentOf(this.fiber.type);
    if (!component) return false;

    const original = (component.render as WrappedComponent).pppOriginal ?? component.render;
    const overrides = this.props;
    const wrapper: WrappedComponent = function pppMasonry(
      this: unknown,
      props: Record<string, unknown>,
      ...rest: unknown[]
    ): unknown {
      const native = readNativeMasonryProps(props);
      if (!native) {
        controller.onContractBroken('Pinterest rendered Masonry with props this build cannot override.');
        return original.call(this, props, ...rest);
      }
      controller.onNativeProps(native);
      // The live item list must stay current: scroll anchoring resolves an
      // index against it after every reflow.
      overrides.items = props.items as ReadonlyArray<unknown>;
      return original.call(this, {
        ...props,
        columnWidth: overrides.columnWidth,
        layout: overrides.layout,
        minCols: overrides.minCols,
      }, ...rest);
    };
    wrapper.pppOriginal = original;

    const patched = component.rebuild(wrapper);
    this.forEachFiber((fiber) => { fiber.type = patched; });
    this.controller = controller;
    this.installed = true;
    this.measureContainer();
    return true;
  }

  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;
    this.controller = null;
    this.forEachFiber((fiber) => {
      const original = originalOf(fiber.type);
      if (!original) return;
      const component = componentOf(fiber.type);
      if (component) fiber.type = component.rebuild(original);
    });
  }

  private forEachFiber(visit: (fiber: MasonryFiber) => void): void {
    visit(this.fiber);
    if (this.fiber.alternate) visit(this.fiber.alternate);
  }
}

/**
 * One adapter per mounted grid. React swaps between two fiber objects on every
 * render, so the wrapper element — which outlives them both — is the stable
 * identity; a remount produces a new element and therefore a new adapter.
 */
const adapters = new WeakMap<HTMLElement, HooksMasonryInstance>();

export function findHooksMasonryInstance(
  root: HTMLElement,
  fiber: MasonryFiber,
  win: Window & typeof globalThis = window,
): HooksMasonryInstance | null {
  if (!isHooksMasonryFiber(fiber)) return null;
  const gridWrapper = hostElementOf(fiber) ?? root;
  if (!gridWrapper.contains(root)) return null;

  const existing = adapters.get(gridWrapper);
  if (existing) {
    existing.adopt(fiber);
    return existing;
  }
  const adapter = new HooksMasonryInstance(fiber, gridWrapper, win);
  adapters.set(gridWrapper, adapter);
  return adapter;
}
