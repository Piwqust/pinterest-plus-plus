import {
  GRID_DESTROY_EVENT,
  GRID_SET_WIDTH_EVENT,
  GRID_STATUS_EVENT,
  type GridMetrics,
  type GridSetWidthDetail,
  type GridStatusDetail,
  isGridSetWidthDetail,
} from './grid-bridge-events';
import { ANY_PIN_SELECTOR, containsPin, findPinGridRoots } from './pin-grid-roots';
import {
  HooksMasonryInstance,
  type MasonryFiber,
  findHooksMasonryInstance,
} from './hooks-masonry';
import { DEFAULT_GUTTER, DEFAULT_TILE_WIDTH, clampTileWidth, columnsForWidth } from './settings';

export { findPinGridRoots } from './pin-grid-roots';

const GRID_ITEM_SELECTOR = '[data-grid-item]';
const GRID_ITEM_INDEX_SELECTOR = '[data-grid-item-idx]';
const ROOT_DISCOVERY_TIMEOUT = 2_000;
// Deep feeds can need several animation frames to repopulate Gestalt's measurements
// after a large column-count change. Contract discovery stays capped at two seconds,
// but an already verified native reflow gets a wider settling window.
const REFLOW_TIMEOUT = 8_000;
const ANCHOR_RESTORE_TIMEOUT = 2_500;
/** Frames of unchanged geometry that count as settled when flags stay pending. */
const GEOMETRY_SETTLE_FRAMES = 20;
const MUTATION_DEBOUNCE = 100;
const RESIZE_DEBOUNCE = 150;
// A Pinterest build that genuinely broke the contract must not be retried forever.
const MAX_UNSUPPORTED_RECOVERIES = 3;

type BrowserWindow = Window & typeof globalThis;

export interface MasonryPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface MasonryPositionStore {
  get(item: unknown): MasonryPosition | undefined;
  has(item: unknown): boolean;
  reset(): void;
}

export interface MasonryProps {
  columnWidth: number;
  layout: string;
  minCols: number;
  virtualize: boolean;
  items: ReadonlyArray<unknown>;
}

interface MasonryState {
  gutter?: number;
  hasPendingMeasurements?: boolean;
  scrollTop?: number;
  width?: number | null;
}

interface MasonryScrollContainer {
  getScrollContainerRef(): HTMLElement | Window | null | undefined;
}

export interface MasonryInstance {
  props: MasonryProps;
  state: MasonryState;
  positionStore: MasonryPositionStore;
  gridWrapper: HTMLElement;
  scrollContainer: MasonryScrollContainer;
  containerOffset: number;
  maxHeight: number;
  render(): unknown;
  reflow(): void;
}

export interface NativeProps {
  columnWidth: number;
  layout: string;
  minCols: number;
}

interface InstancePatch {
  instance: MasonryInstance;
  root: HTMLElement;
  originalRender: MasonryInstance['render'];
  nativeProps: NativeProps;
  lastProps: MasonryProps;
  requestedWidth: number;
  effectiveWidth: number;
  committedWidth?: number;
  contractBroken: boolean;
  /** False when the grid exposes no position store to anchor the scroll to. */
  anchorable: boolean;
}

interface Anchor {
  item: unknown;
  index: number;
  viewportOffset: number;
  scrollContainer: HTMLElement | Window;
}

interface StyleSnapshot {
  element: HTMLElement;
  property: string;
  value: string;
  priority: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isPositionStore(value: unknown): value is MasonryPositionStore {
  return isRecord(value) && typeof value.get === 'function' &&
    typeof value.has === 'function' && typeof value.reset === 'function';
}

function isScrollContainer(value: unknown): value is MasonryScrollContainer {
  return isRecord(value) && typeof value.getScrollContainerRef === 'function';
}

export function isCompatibleMasonry(value: unknown, root: HTMLElement): value is MasonryInstance {
  if (!isRecord(value) || !isRecord(value.props) || !isRecord(value.state)) return false;
  const props = value.props;
  return typeof props.columnWidth === 'number' && Number.isFinite(props.columnWidth) &&
    typeof props.layout === 'string' &&
    typeof props.minCols === 'number' && Number.isFinite(props.minCols) && props.minCols >= 1 &&
    props.virtualize === true && Array.isArray(props.items) &&
    value.gridWrapper instanceof HTMLElement && value.gridWrapper.contains(root) &&
    isPositionStore(value.positionStore) && isScrollContainer(value.scrollContainer) &&
    typeof value.containerOffset === 'number' && Number.isFinite(value.containerOffset) &&
    typeof value.maxHeight === 'number' && Number.isFinite(value.maxHeight) &&
    typeof value.render === 'function' && typeof value.reflow === 'function' &&
    !Object.isFrozen(props);
}

/**
 * Pinterest renders the home feed with a class Masonry and other surfaces —
 * search, pin close-up, profile — with a hooks-based one whose fiber has no
 * `stateNode`. The class instance wins whenever one exists, so the feed keeps
 * the path it has always used; otherwise the nearest hooks Masonry is adapted
 * to the same interface.
 */
export function findMasonryInstance(
  root: HTMLElement,
  win: Window & typeof globalThis = window,
): MasonryInstance | null {
  const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
  if (!fiberKey) return null;
  let fiber = (root as unknown as Record<string, unknown>)[fiberKey] as MasonryFiber | undefined;
  let hooksInstance: MasonryInstance | null = null;
  for (let depth = 0; fiber && depth < 24; depth += 1, fiber = fiber.return ?? undefined) {
    if (isCompatibleMasonry(fiber.stateNode, root)) return fiber.stateNode;
    hooksInstance ??= findHooksMasonryInstance(root, fiber, win);
  }
  return hooksInstance;
}

export function calculateEffectiveLayout(
  requestedWidth: number,
  availableWidth: number,
  gutter: number,
  nativeMinCols: number,
): { width: number; minCols: number; columns: number } {
  const safeAvailable = Number.isFinite(availableWidth) && availableWidth > 0
    ? Math.floor(availableWidth)
    : requestedWidth;
  const width = Math.min(clampTileWidth(requestedWidth), safeAvailable);
  const safeGutter = Number.isFinite(gutter) && gutter >= 0 ? gutter : 0;
  const columns = columnsForWidth(width, safeAvailable, safeGutter);
  return { width, minCols: Math.max(1, Math.min(Math.floor(nativeMinCols), columns)), columns };
}

/** The live geometry of a patched grid, reported to the slider. */
function readMetrics(instance: MasonryInstance, width: number): GridMetrics | null {
  const measured = instance.state.width ?? instance.gridWrapper.clientWidth;
  if (!Number.isFinite(measured) || measured <= 0) return null;
  const availableWidth = Math.floor(measured);
  const reported = instance.state.gutter;
  const gutter = typeof reported === 'number' && Number.isFinite(reported) && reported >= 0
    ? reported
    : DEFAULT_GUTTER;
  return { availableWidth, gutter, columns: columnsForWidth(width, availableWidth, gutter) };
}

function sameMetrics(a: GridMetrics | null, b: GridMetrics | null): boolean {
  if (!a || !b) return a === b;
  return a.availableWidth === b.availableWidth && a.gutter === b.gutter && a.columns === b.columns;
}

function statusDetail(detail: GridStatusDetail, metrics: GridMetrics | null): GridStatusDetail {
  return metrics ? { ...detail, metrics } : detail;
}

function readNativeProps(props: MasonryProps): NativeProps | null {
  if (typeof props.columnWidth !== 'number' || !Number.isFinite(props.columnWidth) ||
      typeof props.layout !== 'string' ||
      typeof props.minCols !== 'number' || !Number.isFinite(props.minCols) || props.minCols < 1) {
    return null;
  }
  return { columnWidth: props.columnWidth, layout: props.layout, minCols: props.minCols };
}

function applyOverrides(patch: InstancePatch): number {
  const { instance } = patch;
  const available = instance.state.width ?? instance.gridWrapper.clientWidth;
  const layout = calculateEffectiveLayout(
    patch.requestedWidth,
    available ?? patch.requestedWidth,
    instance.state.gutter ?? 0,
    patch.nativeProps.minCols,
  );
  instance.props.columnWidth = layout.width;
  instance.props.layout = 'basicCentered';
  instance.props.minCols = layout.minCols;
  patch.effectiveWidth = layout.width;
  return layout.width;
}

function snapshotStyle(element: HTMLElement, property: string): StyleSnapshot {
  return {
    element,
    property,
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
}

function restoreStyle(snapshot: StyleSnapshot): void {
  if (snapshot.value) snapshot.element.style.setProperty(snapshot.property, snapshot.value, snapshot.priority);
  else snapshot.element.style.removeProperty(snapshot.property);
}

function rootForPatch(patch: InstancePatch): HTMLElement | null {
  if (patch.root.isConnected && patch.instance.gridWrapper.contains(patch.root)) return patch.root;
  return Array.from(patch.instance.gridWrapper.querySelectorAll<HTMLElement>('[role="list"]'))
    .find((root) => Boolean(root.querySelector(ANY_PIN_SELECTOR))) ?? null;
}

function getScrollViewport(container: HTMLElement | Window, win: BrowserWindow): { top: number; bottom: number } {
  if (container === win) return { top: 0, bottom: win.innerHeight };
  const rect = (container as HTMLElement).getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

function captureAnchor(patch: InstancePatch, win: BrowserWindow): Anchor | null {
  const root = rootForPatch(patch);
  if (!root) return null;
  const scrollContainer = patch.instance.scrollContainer.getScrollContainerRef();
  if (!scrollContainer || (scrollContainer !== win && !(scrollContainer instanceof HTMLElement))) return null;
  const viewport = getScrollViewport(scrollContainer, win);
  const visibleItems = Array.from(root.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > viewport.top && rect.top < viewport.bottom)
    .sort((a, b) => Math.abs(a.rect.top - viewport.top) - Math.abs(b.rect.top - viewport.top));
  const anchorElement = visibleItems[0];
  if (!anchorElement) return null;
  const indexValue = anchorElement.element.querySelector<HTMLElement>(GRID_ITEM_INDEX_SELECTOR)
    ?.getAttribute('data-grid-item-idx');
  if (indexValue === null || indexValue === undefined) return null;
  const index = Number(indexValue);
  const item = patch.instance.props.items[index];
  if (!Number.isSafeInteger(index) || item === undefined) return null;
  return {
    item,
    index,
    viewportOffset: anchorElement.rect.top - viewport.top,
    scrollContainer,
  };
}

function setScrollPosition(container: HTMLElement | Window, top: number, win: BrowserWindow): void {
  const normalized = Math.max(0, top);
  if (container === win) win.scrollTo(win.scrollX, normalized);
  else (container as HTMLElement).scrollTop = normalized;
}

function restoreAnchor(patch: InstancePatch, anchor: Anchor, win: BrowserWindow): boolean {
  const position = patch.instance.positionStore.get(anchor.item);
  if (!position) return false;
  setScrollPosition(
    anchor.scrollContainer,
    patch.instance.containerOffset + position.top - anchor.viewportOffset,
    win,
  );
  return true;
}

function isRootVisible(root: HTMLElement, win: BrowserWindow): boolean {
  const rect = root.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < win.innerHeight;
}

function hasVisibleGridItem(patch: InstancePatch, win: BrowserWindow): boolean {
  const root = rootForPatch(patch);
  if (!root || !isRootVisible(root, win)) return true;
  return Array.from(root.querySelectorAll<HTMLElement>(GRID_ITEM_SELECTOR)).some((item) => {
    const rect = item.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < win.innerHeight;
  });
}

function frame(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => resolve());
    else win.setTimeout(resolve, 16);
  });
}

function wait(win: BrowserWindow, duration: number): Promise<void> {
  return new Promise((resolve) => win.setTimeout(resolve, duration));
}

export class MasonryGridBridge {
  private observer: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private mutationTimer: number | undefined;
  private resizeTimer: number | undefined;
  private patches = new Map<MasonryInstance, InstancePatch>();
  private currentRequest: GridSetWidthDetail | null = null;
  private lastMetrics: GridMetrics | null = null;
  private lastRoots: HTMLElement[] = [];
  private wrapperWidths = new WeakMap<Element, number>();
  private generation = 0;
  private processing = false;
  private processAgain = false;
  private reportNext = false;
  private unsupported = false;
  private unsupportedUrl = '';
  private unsupportedRoots: HTMLElement[] = [];
  private unsupportedRecoveries = 0;
  private destroyed = false;

  constructor(
    private doc: Document = document,
    private win: BrowserWindow = window,
  ) {}

  start(): void {
    this.doc.addEventListener(GRID_SET_WIDTH_EVENT, this.onSetWidth as EventListener);
    this.doc.addEventListener(GRID_DESTROY_EVENT, this.onDestroy);
    this.win.addEventListener('resize', this.onViewportChange);
    this.startObserver();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.mutationTimer !== undefined) this.win.clearTimeout(this.mutationTimer);
    if (this.resizeTimer !== undefined) this.win.clearTimeout(this.resizeTimer);
    this.doc.removeEventListener(GRID_SET_WIDTH_EVENT, this.onSetWidth as EventListener);
    this.doc.removeEventListener(GRID_DESTROY_EVENT, this.onDestroy);
    this.win.removeEventListener('resize', this.onViewportChange);
    this.restoreAll(true);
  }

  private startObserver(): void {
    const target = this.doc.documentElement;
    if (!target) {
      this.doc.addEventListener('DOMContentLoaded', () => this.startObserver(), { once: true });
      return;
    }
    const observer = new this.win.MutationObserver((records: MutationRecord[]) => {
      if (!this.currentRequest || this.destroyed) return;
      if (records.some((record) =>
        Array.from(record.addedNodes).some(containsPin) || Array.from(record.removedNodes).some(containsPin),
      )) this.scheduleRefresh();
    });
    this.observer = observer;
    observer.observe(target, { childList: true, subtree: true });
  }

  private observeWrapper(wrapper: HTMLElement): void {
    if (typeof this.win.ResizeObserver !== 'function') return;
    // The wrapper grows taller on every infinite-scroll batch; only a width
    // change can invalidate the column math, so height churn is ignored.
    this.resizeObserver ??= new this.win.ResizeObserver((entries: ResizeObserverEntry[]) => {
      const widened = entries.filter((entry) => {
        const width = Math.round(entry.contentRect.width);
        if (this.wrapperWidths.get(entry.target) === width) return false;
        this.wrapperWidths.set(entry.target, width);
        return true;
      });
      if (widened.length > 0) this.onViewportChange();
    });
    this.wrapperWidths.set(wrapper, Math.round(wrapper.getBoundingClientRect().width));
    this.resizeObserver.observe(wrapper);
  }

  private scheduleRefresh(): void {
    if (this.mutationTimer !== undefined) return;
    this.mutationTimer = this.win.setTimeout(() => {
      this.mutationTimer = undefined;
      if (this.destroyed) return;
      // Pinterest remounting the feed is also how a page recovers from a build
      // that briefly failed the Masonry contract.
      this.tryRecover(true);
      if (this.unsupported || !this.currentRequest) return;
      if (this.currentRequest.width === DEFAULT_TILE_WIDTH) return;
      this.queueProcess(false);
    }, MUTATION_DEBOUNCE);
  }

  /** A viewport or container width change invalidates the column math. */
  private onViewportChange = (): void => {
    if (this.resizeTimer !== undefined) return;
    this.resizeTimer = this.win.setTimeout(() => {
      this.resizeTimer = undefined;
      if (this.destroyed || this.unsupported || !this.currentRequest) return;
      if (this.currentRequest.width === DEFAULT_TILE_WIDTH && this.patches.size === 0) return;
      this.queueProcess(false);
    }, RESIZE_DEBOUNCE);
  };

  private tryRecover(reapply: boolean): void {
    if (!this.unsupported || this.unsupportedRecoveries >= MAX_UNSUPPORTED_RECOVERIES) return;
    const navigated = this.win.location.href !== this.unsupportedUrl;
    const remounted = this.unsupportedRoots.length > 0 &&
      this.unsupportedRoots.every((root) => !root.isConnected);
    if (!navigated && !remounted) return;
    this.unsupportedRecoveries += 1;
    this.unsupported = false;
    this.unsupportedUrl = '';
    this.unsupportedRoots = [];
    this.generation += 1;
    if (reapply && this.currentRequest) this.queueProcess(true);
  }

  private onSetWidth = (event: CustomEvent<unknown>): void => {
    if (!isGridSetWidthDetail(event.detail) || this.destroyed) return;
    const request = { requestId: event.detail.requestId, width: clampTileWidth(event.detail.width) };
    this.tryRecover(false);
    this.currentRequest = request;
    this.generation += 1;
    if (this.unsupported) {
      this.emitStatus({ requestId: request.requestId, requestedWidth: request.width, state: 'unsupported' });
      return;
    }
    this.emitStatus({ requestId: request.requestId, requestedWidth: request.width, state: 'applying' });
    this.queueProcess(true);
  };

  private onDestroy = (): void => this.destroy();

  private queueProcess(userRequest: boolean): void {
    this.processAgain = true;
    this.reportNext ||= userRequest;
    if (this.processing) return;
    this.processing = true;
    this.win.queueMicrotask(() => void (async () => {
      while (this.processAgain && !this.destroyed) {
        this.processAgain = false;
        const shouldReport = this.reportNext;
        this.reportNext = false;
        const request = this.currentRequest;
        const generation = this.generation;
        if (request) await this.applyRequest(request, generation, shouldReport);
      }
      this.processing = false;
    })());
  }

  private async applyRequest(
    request: GridSetWidthDetail,
    generation: number,
    reportStatus: boolean,
  ): Promise<void> {
    this.releaseDisconnectedPatches();
    if (request.width === DEFAULT_TILE_WIDTH) {
      await this.restoreNativeLayout(request, generation);
      return;
    }

    // An instance that is already patched stays authoritative. Rediscovering it
    // from the DOM would fail at large tile sizes, where virtualization keeps
    // only a couple of pins mounted, and the grid would become unreachable.
    const live = this.livePatchedInstances();
    let roots = findPinGridRoots(this.doc, this.win.innerWidth);
    if (roots.length === 0 && live.length === 0) {
      if (reportStatus && generation === this.generation) {
        this.emitStatus({
          requestId: request.requestId,
          requestedWidth: request.width,
          effectiveWidth: request.width,
          state: 'applied',
        });
      }
      return;
    }
    if (roots.length > 0) this.lastRoots = roots;

    let discovered = this.mergeInstances(live, this.discoverInstances(roots));
    const discoveryDeadline = this.win.performance.now() + ROOT_DISCOVERY_TIMEOUT;
    while (discovered.length === 0 && generation === this.generation &&
      this.win.performance.now() < discoveryDeadline) {
      await wait(this.win, MUTATION_DEBOUNCE);
      roots = findPinGridRoots(this.doc, this.win.innerWidth);
      if (roots.length === 0) return;
      this.lastRoots = roots;
      discovered = this.discoverInstances(roots);
    }
    if (generation !== this.generation || this.destroyed) return;
    if (discovered.length === 0) {
      this.failUnsupported(request, 'No verified Masonry instance was found before the discovery deadline.');
      return;
    }

    const changed: InstancePatch[] = [];
    for (const { root, instance } of discovered) {
      const existingPatch = this.patches.get(instance);
      let patch: InstancePatch;
      if (!existingPatch) {
        const createdPatch = this.patchInstance(instance, root, request.width);
        if (!createdPatch) {
          this.failUnsupported(request, 'The Masonry instance could not be patched safely.');
          return;
        }
        patch = createdPatch;
        this.patches.set(instance, patch);
        this.observeWrapper(instance.gridWrapper);
      } else {
        patch = existingPatch;
        patch.root = root;
        patch.requestedWidth = request.width;
      }
      const effectiveWidth = applyOverrides(patch);
      if (patch.committedWidth !== effectiveWidth) changed.push(patch);
    }

    if (changed.length === 0) {
      const settledPatch = discovered[0] ? this.patches.get(discovered[0].instance) : undefined;
      const metrics = settledPatch
        ? readMetrics(settledPatch.instance, settledPatch.effectiveWidth)
        : null;
      // A background refresh still reports geometry when the grid itself moved,
      // so the slider can rebound its range without a user gesture.
      if (generation === this.generation && (reportStatus || !sameMetrics(metrics, this.lastMetrics))) {
        this.emitStatus(statusDetail({
          requestId: request.requestId,
          requestedWidth: request.width,
          effectiveWidth: settledPatch?.effectiveWidth ?? request.width,
          state: 'applied',
        }, metrics));
      }
      return;
    }

    const primary = this.selectPrimaryPatch(changed);
    const anchor = primary?.anchorable ? captureAnchor(primary, this.win) : null;
    const styleSnapshots: StyleSnapshot[] = [];

    try {
      for (const patch of changed) {
        const root = rootForPatch(patch);
        const wrapperHeight = patch.instance.gridWrapper.getBoundingClientRect().height;
        if (wrapperHeight > 0) {
          styleSnapshots.push(snapshotStyle(patch.instance.gridWrapper, 'min-height'));
          patch.instance.gridWrapper.style.setProperty('min-height', `${wrapperHeight}px`, 'important');
        }
        if (root) {
          styleSnapshots.push(snapshotStyle(root, 'overflow-anchor'));
          root.style.setProperty('overflow-anchor', 'none', 'important');
        }
      }
      if (anchor) {
        const scrollElement = anchor.scrollContainer === this.win
          ? this.doc.documentElement
          : anchor.scrollContainer as HTMLElement;
        styleSnapshots.push(snapshotStyle(scrollElement, 'scroll-behavior'));
        scrollElement.style.setProperty('scroll-behavior', 'auto', 'important');
      }

      for (const patch of changed) {
        patch.instance.maxHeight = 0;
        patch.instance.reflow();
      }
      const settled = await this.waitForReflow(changed, primary, anchor, generation);
      if (generation !== this.generation || this.destroyed) return;
      // Only a genuine contract violation disables resizing. A slow settle or a
      // scroll anchor that cannot be re-found are cosmetic: the layout applied,
      // and taking the control away would strand the user at that tile size.
      if (changed.some((patch) => patch.contractBroken)) {
        this.failUnsupported(request, 'The Masonry render contract changed during reflow.');
        return;
      }
      const anchorRestored = primary && anchor
        ? await this.restoreAnchorAndWaitForVisible(primary, anchor, generation)
        : primary
          ? await this.waitForVisibleGrid(primary, generation)
          : true;
      if (generation !== this.generation || this.destroyed) return;
      if (!settled || !anchorRestored) {
        this.win.console.warn(
          '[Pinterest++] The Masonry reflow settled slowly; the scroll position may have shifted.',
        );
      }
      for (const patch of changed) patch.committedWidth = patch.effectiveWidth;
      const settledPatch = primary ?? changed[0]!;
      this.emitStatus(statusDetail({
        requestId: request.requestId,
        requestedWidth: request.width,
        effectiveWidth: settledPatch.effectiveWidth,
        state: 'applied',
      }, readMetrics(settledPatch.instance, settledPatch.effectiveWidth)));
    } catch (error) {
      this.failUnsupported(request, `The Masonry transaction threw: ${String(error)}`);
    } finally {
      for (const snapshot of styleSnapshots.reverse()) restoreStyle(snapshot);
    }
  }

  /** Patched instances whose grid is still mounted, regardless of pin count. */
  private livePatchedInstances(): Array<{ root: HTMLElement; instance: MasonryInstance }> {
    const live: Array<{ root: HTMLElement; instance: MasonryInstance }> = [];
    for (const patch of this.patches.values()) {
      if (!patch.instance.gridWrapper.isConnected) continue;
      live.push({ root: rootForPatch(patch) ?? patch.root, instance: patch.instance });
    }
    return live;
  }

  private mergeInstances(
    live: Array<{ root: HTMLElement; instance: MasonryInstance }>,
    discovered: Array<{ root: HTMLElement; instance: MasonryInstance }>,
  ): Array<{ root: HTMLElement; instance: MasonryInstance }> {
    const seen = new Set(live.map((entry) => entry.instance));
    return [...live, ...discovered.filter((entry) => !seen.has(entry.instance))];
  }

  private discoverInstances(roots: HTMLElement[]): Array<{ root: HTMLElement; instance: MasonryInstance }> {
    const seen = new Set<MasonryInstance>();
    const discovered: Array<{ root: HTMLElement; instance: MasonryInstance }> = [];
    for (const root of roots) {
      const instance = findMasonryInstance(root, this.win);
      if (!instance || seen.has(instance)) continue;
      seen.add(instance);
      discovered.push({ root, instance });
    }
    return discovered;
  }

  private patchInstance(
    instance: MasonryInstance,
    root: HTMLElement,
    requestedWidth: number,
  ): InstancePatch | null {
    const nativeProps = readNativeProps(instance.props);
    if (!nativeProps) return null;
    const patch: InstancePatch = {
      instance,
      root,
      originalRender: instance.render,
      nativeProps,
      lastProps: instance.props,
      requestedWidth,
      effectiveWidth: requestedWidth,
      contractBroken: false,
      anchorable: true,
    };
    const bridge = this;

    // A hooks Masonry has no instance method to wrap; it injects its overrides
    // through the fiber's component instead, but reports the same failures.
    if (instance instanceof HooksMasonryInstance) {
      patch.anchorable = instance.anchorable;
      const installed = instance.install({
        onContractBroken: (reason) => {
          patch.contractBroken = true;
          bridge.win.queueMicrotask(() => {
            if (bridge.currentRequest) bridge.failUnsupported(bridge.currentRequest, reason);
          });
        },
        onNativeProps: (next) => { patch.nativeProps = next; },
      });
      if (!installed) return null;
      try {
        applyOverrides(patch);
        return patch;
      } catch {
        instance.uninstall();
        return null;
      }
    }

    instance.render = function patchedMasonryRender(this: MasonryInstance): unknown {
      if (this.props !== patch.lastProps) {
        const nextNativeProps = readNativeProps(this.props);
        if (!nextNativeProps || Object.isFrozen(this.props)) {
          patch.contractBroken = true;
          bridge.win.queueMicrotask(() => {
            if (bridge.currentRequest) {
              bridge.failUnsupported(
                bridge.currentRequest,
                'Pinterest replaced the Masonry props with an incompatible or immutable object.',
              );
            }
          });
          return patch.originalRender.call(this);
        }
        patch.nativeProps = nextNativeProps;
        patch.lastProps = this.props;
      }
      try {
        applyOverrides(patch);
      } catch {
        patch.contractBroken = true;
      }
      return patch.originalRender.call(this);
    };
    try {
      applyOverrides(patch);
      return patch;
    } catch {
      instance.render = patch.originalRender;
      return null;
    }
  }

  private selectPrimaryPatch(patches: InstancePatch[]): InstancePatch | null {
    return [...patches].sort((a, b) => {
      const aRect = rootForPatch(a)?.getBoundingClientRect();
      const bRect = rootForPatch(b)?.getBoundingClientRect();
      const aVisible = aRect ? aRect.bottom > 0 && aRect.top < this.win.innerHeight : false;
      const bVisible = bRect ? bRect.bottom > 0 && bRect.top < this.win.innerHeight : false;
      if (aVisible !== bVisible) return aVisible ? -1 : 1;
      return Math.abs(aRect?.top ?? Infinity) - Math.abs(bRect?.top ?? Infinity);
    })[0] ?? null;
  }

  private async waitForReflow(
    patches: InstancePatch[],
    primary: InstancePatch | null,
    anchor: Anchor | null,
    generation: number,
    expectPatchedWidth = true,
  ): Promise<boolean> {
    const deadline = this.win.performance.now() + REFLOW_TIMEOUT;
    let previousSignature = '';
    let stableFrames = 0;
    let readyFrames = 0;
    while (this.win.performance.now() < deadline) {
      await frame(this.win);
      if (generation !== this.generation || this.destroyed) return false;
      let ready = true;
      const signatureParts: string[] = [];
      for (const patch of patches) {
        const root = rootForPatch(patch);
        if (!root || patch.instance.state.hasPendingMeasurements === true) ready = false;
        const height = root?.getBoundingClientRect().height ?? -1;
        signatureParts.push(`${Math.round(height * 2) / 2}:${patch.effectiveWidth}`);
      }
      if (primary && anchor) {
        const position = primary.instance.positionStore.get(anchor.item);
        if (!position || (expectPatchedWidth && Math.abs(position.width - primary.effectiveWidth) > 1)) {
          ready = false;
        }
        signatureParts.push(position ? `${Math.round(position.top * 2) / 2}:${position.width}` : 'anchor-missing');
      }
      const signature = signatureParts.join('|');
      stableFrames = signature === previousSignature ? stableFrames + 1 : 0;
      readyFrames = ready && signature === previousSignature ? readyFrames + 1 : 0;
      previousSignature = signature;
      // A large column-count change keeps Gestalt measuring while images load,
      // so geometry that has stopped moving also counts as settled.
      if (readyFrames >= 2 || stableFrames >= GEOMETRY_SETTLE_FRAMES) return true;
    }
    return false;
  }

  private async restoreNativeLayout(request: GridSetWidthDetail, generation: number): Promise<void> {
    const patches = [...this.patches.values()].filter((patch) => patch.instance.gridWrapper.isConnected);
    if (patches.length === 0) {
      this.patches.clear();
      if (generation === this.generation) {
        // Read the native geometry without patching anything: the slider needs
        // the grid's real width before the first resize is ever requested.
        const native = this.discoverInstances(findPinGridRoots(this.doc, this.win.innerWidth))[0];
        this.emitStatus(statusDetail({
          requestId: request.requestId,
          requestedWidth: request.width,
          effectiveWidth: request.width,
          state: 'applied',
        }, native ? readMetrics(native.instance, request.width) : null));
      }
      return;
    }

    const primary = this.selectPrimaryPatch(patches);
    const anchor = primary?.anchorable ? captureAnchor(primary, this.win) : null;
    const styleSnapshots: StyleSnapshot[] = [];
    try {
      for (const patch of patches) {
        const root = rootForPatch(patch);
        const wrapperHeight = patch.instance.gridWrapper.getBoundingClientRect().height;
        if (wrapperHeight > 0) {
          styleSnapshots.push(snapshotStyle(patch.instance.gridWrapper, 'min-height'));
          patch.instance.gridWrapper.style.setProperty('min-height', `${wrapperHeight}px`, 'important');
        }
        if (root) {
          styleSnapshots.push(snapshotStyle(root, 'overflow-anchor'));
          root.style.setProperty('overflow-anchor', 'none', 'important');
        }
      }
      if (anchor) {
        const scrollElement = anchor.scrollContainer === this.win
          ? this.doc.documentElement
          : anchor.scrollContainer as HTMLElement;
        styleSnapshots.push(snapshotStyle(scrollElement, 'scroll-behavior'));
        scrollElement.style.setProperty('scroll-behavior', 'auto', 'important');
      }

      for (const patch of patches) this.restorePatch(patch, true);
      const settled = await this.waitForReflow(patches, primary, anchor, generation, false);
      if (generation !== this.generation || this.destroyed) return;
      if (settled && primary && anchor) {
        await this.restoreAnchorAndWaitForVisible(primary, anchor, generation);
      } else if (settled && primary) {
        await this.waitForVisibleGrid(primary, generation);
      }
      const measured = primary ?? patches[0]!;
      this.emitStatus(statusDetail({
        requestId: request.requestId,
        requestedWidth: request.width,
        effectiveWidth: request.width,
        state: 'applied',
      }, readMetrics(measured.instance, request.width)));
    } finally {
      this.patches.clear();
      for (const snapshot of styleSnapshots.reverse()) restoreStyle(snapshot);
    }
  }

  private async restoreAnchorAndWaitForVisible(
    patch: InstancePatch,
    anchor: Anchor,
    generation: number,
  ): Promise<boolean> {
    const deadline = this.win.performance.now() + ANCHOR_RESTORE_TIMEOUT;
    let stableFrames = 0;
    while (this.win.performance.now() < deadline) {
      if (generation !== this.generation || this.destroyed) return false;
      restoreAnchor(patch, anchor, this.win);
      await frame(this.win);
      const root = rootForPatch(patch);
      const viewport = getScrollViewport(anchor.scrollContainer, this.win);
      const currentIndex = patch.instance.props.items.indexOf(anchor.item);
      const renderedIndex = currentIndex >= 0 ? currentIndex : anchor.index;
      const indexNode = root
        ? Array.from(root.querySelectorAll<HTMLElement>(GRID_ITEM_INDEX_SELECTOR))
          .find((element) => element.getAttribute('data-grid-item-idx') === String(renderedIndex))
        : null;
      const item = indexNode?.closest<HTMLElement>(GRID_ITEM_SELECTOR);
      if (!item) {
        stableFrames = 0;
        continue;
      }
      const rect = item.getBoundingClientRect();
      const visible = rect.bottom > viewport.top && rect.top < viewport.bottom;
      const offsetError = Math.abs((rect.top - viewport.top) - anchor.viewportOffset);
      stableFrames = visible && offsetError <= 8 ? stableFrames + 1 : 0;
      if (stableFrames >= 2) return true;
    }
    return false;
  }

  private async waitForVisibleGrid(patch: InstancePatch, generation: number): Promise<boolean> {
    const deadline = this.win.performance.now() + ANCHOR_RESTORE_TIMEOUT;
    while (this.win.performance.now() < deadline) {
      if (generation !== this.generation || this.destroyed) return false;
      if (hasVisibleGridItem(patch, this.win)) return true;
      await frame(this.win);
    }
    return false;
  }

  private releaseDisconnectedPatches(): void {
    for (const [instance, patch] of this.patches) {
      if (instance.gridWrapper.isConnected) continue;
      this.restorePatch(patch, false);
      this.patches.delete(instance);
    }
  }

  private restorePatch(patch: InstancePatch, reflow: boolean): void {
    const { instance } = patch;
    if (instance instanceof HooksMasonryInstance) instance.uninstall();
    else instance.render = patch.originalRender;
    this.resizeObserver?.unobserve(instance.gridWrapper);
    try {
      instance.props.columnWidth = patch.nativeProps.columnWidth;
      instance.props.layout = patch.nativeProps.layout;
      instance.props.minCols = patch.nativeProps.minCols;
      instance.maxHeight = 0;
      if (reflow && instance.gridWrapper.isConnected) instance.reflow();
    } catch {
      // The page owns this instance; best-effort restoration is safer than another override.
    }
  }

  private restoreAll(reflow: boolean): void {
    for (const patch of this.patches.values()) this.restorePatch(patch, reflow);
    this.patches.clear();
  }

  private failUnsupported(request: GridSetWidthDetail, reason = 'Unknown compatibility failure.'): void {
    if (this.unsupported || this.destroyed) return;
    this.unsupported = true;
    // Remember what the page looked like when it failed, so a later remount or
    // client-side navigation can lift the latch instead of stranding the slider.
    this.unsupportedUrl = this.win.location.href;
    this.unsupportedRoots = this.lastRoots.filter((root) => root.isConnected);
    this.generation += 1;
    this.win.console.warn(`[Pinterest++] Grid resizing disabled: ${reason}`);
    this.restoreAll(true);
    this.emitStatus({
      requestId: request.requestId,
      requestedWidth: request.width,
      state: 'unsupported',
    });
  }

  private emitStatus(detail: GridStatusDetail): void {
    if (detail.state === 'applied') this.lastMetrics = detail.metrics ?? null;
    this.doc.dispatchEvent(new this.win.CustomEvent<GridStatusDetail>(GRID_STATUS_EVENT, { detail }));
  }
}
