import { withTimeout } from './async';
import {
  ALL_VIEW,
  EMPTY_FILTERS,
  HUES,
  HUE_SWATCH,
  MAX_COLLECTED_PINS,
  SHAPES,
  UNFILED_VIEW,
  directoryName,
  exportExtension,
  exportStem,
  folderCounts,
  isFiltering,
  pinUrl,
  visiblePins,
  type CollectedPin,
  type CollectionFilters,
  type FolderView,
  type Hue,
  type KindFilter,
  type Shape,
} from './collection';
import type { CollectionStore } from './collection-store';
import {
  ARCHIVE_PORT,
  isActionResponse,
  type ArchiveEvent,
  type ArchiveItem,
  type ArchiveRequest,
  type DownloadMediaMessage,
} from './messages';
import { scanPage } from './page-scan';
import { PaletteQueue, capturePin, isPromotedPin } from './pin-capture';
import { writeCollectionPrefs, type CollectionPrefs, type ExportFormat } from './settings';
import { ICONS } from './ui-assets';

const SCAN_LIMITS = [50, 100, 250] as const;
const DEFAULT_SCAN_LIMIT = 100;
/** The service worker refuses larger archives; past this, files are saved one by one. */
const MAX_ARCHIVE_PINS = 500;
const FILE_CONCURRENCY = 2;
/** A video with no published file is assembled from its stream, which takes a while. */
const FILE_TIMEOUT_MS = 180_000;
/** How long a destructive button waits for its second click. */
const ARM_MS = 3_000;
const SHAPE_LABEL: Record<Shape, string> = { portrait: 'Portrait', square: 'Square', landscape: 'Landscape' };
const SHAPE_ICON: Record<Shape, string> = {
  portrait: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="4" width="10" height="16" rx="2"/></svg>',
  square: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  landscape: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2"/></svg>',
};
const HUE_LABEL: Record<Hue, string> = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', teal: 'Teal',
  blue: 'Blue', purple: 'Purple', pink: 'Pink', mono: 'Black, white and grey',
};
const KIND_LABEL: Record<KindFilter, string> = { all: 'All', image: 'Images', video: 'Videos' };
const NEW_FOLDER_OPTION = '__new';
const UNFILED_OPTION = '__unfiled';

type Toast = (message: string, error?: boolean) => void;
type NameMode = { kind: 'create' } | { kind: 'rename'; id: string } | { kind: 'move' };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function iconButton(className: string, label: string, icon: string): HTMLButtonElement {
  const node = element('button', className);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  node.innerHTML = icon;
  return node;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The collection's workspace: gathers pins from the page, filters them by
 * type, shape and colour, sorts them into folders and saves them in one go.
 *
 * It lives in the extension's own layer over the page, so Pinterest's
 * re-renders never touch it, and it reads the page only when asked to scan.
 */
export class CollectionPanel {
  readonly launcher: HTMLButtonElement;
  private panel: HTMLElement;
  private launchCount: HTMLElement;
  private subtitle: HTMLElement;
  private scanButton: HTMLButtonElement;
  private limitButtons: HTMLButtonElement[] = [];
  private skipAdsInput: HTMLInputElement;
  private skipRepeatsInput: HTMLInputElement;
  private forgetButton: HTMLButtonElement;
  private folders: HTMLElement;
  private kindButtons: HTMLButtonElement[] = [];
  private shapeButtons: HTMLButtonElement[] = [];
  private hueButtons: HTMLButtonElement[] = [];
  private statusText: HTMLElement;
  private statusActions: HTMLElement;
  private scroll: HTMLElement;
  private grid: HTMLElement;
  private empty: HTMLElement;
  private selectionBar: HTMLElement;
  private selectionText: HTMLElement;
  private moveSelect: HTMLSelectElement;
  private formatButtons: HTMLButtonElement[] = [];
  private creditsInput: HTMLInputElement;
  private downloadButton: HTMLButtonElement;
  private busy: HTMLElement;
  private busyText: HTMLElement;
  private busyCount: HTMLElement;
  private busyBar: HTMLElement;
  private busyCancel: HTMLButtonElement;
  private note: HTMLElement;

  private view: FolderView = ALL_VIEW;
  private filters: CollectionFilters = { ...EMPTY_FILTERS, shapes: [], hues: [] };
  private selected = new Set<string>();
  /** Where a shift-click range starts. */
  private anchorKey: string | null = null;
  private scanLimit = DEFAULT_SCAN_LIMIT;
  private scanning: AbortController | null = null;
  private exporting: AbortController | null = null;
  private nameMode: NameMode | null = null;
  private armed: { button: HTMLButtonElement; timer: number } | null = null;
  private tiles = new Map<string, HTMLElement>();
  private shownOrder = '';
  private shown: CollectedPin[] = [];
  private renderQueued = false;
  private palettes: PaletteQueue;
  private unsubscribe: () => void;

  constructor(
    private layer: HTMLElement,
    private store: CollectionStore,
    private prefs: CollectionPrefs,
    private toast: Toast,
  ) {
    this.palettes = new PaletteQueue(store);

    this.launcher = element('button', 'ppp-c-launch');
    this.launcher.type = 'button';
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.setAttribute('aria-controls', 'ppp-collection');
    this.launcher.title = 'Collection';
    this.launcher.innerHTML = ICONS.collection;
    this.launchCount = element('span', 'ppp-c-launch-count');
    this.launchCount.setAttribute('aria-hidden', 'true');
    this.launcher.append(this.launchCount);

    this.panel = element('aside', 'ppp-c-panel');
    this.panel.id = 'ppp-collection';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-labelledby', 'ppp-c-title');

    // Header
    const head = element('header', 'ppp-c-head');
    const headText = element('div', 'ppp-c-head-text');
    const title = element('h2', 'ppp-c-title', 'Collection');
    title.id = 'ppp-c-title';
    this.subtitle = element('p', 'ppp-c-sub');
    headText.append(title, this.subtitle);
    const close = iconButton('ppp-c-icon', 'Close collection', ICONS.close);
    head.append(headText, close);

    // Scan
    const scanCard = element('section', 'ppp-c-section ppp-c-card ppp-c-scan');
    scanCard.setAttribute('aria-label', 'Collect from this page');
    const scanRow = element('div', 'ppp-c-scan-row');
    this.scanButton = element('button', 'ppp-c-primary ppp-c-grow');
    this.scanButton.type = 'button';
    const limits = element('div', 'ppp-c-seg');
    limits.setAttribute('role', 'group');
    limits.setAttribute('aria-label', 'Pins to collect per scan');
    for (const limit of SCAN_LIMITS) {
      const option = element('button', '', String(limit));
      option.type = 'button';
      option.dataset.limit = String(limit);
      option.setAttribute('aria-label', `Collect ${limit} pins`);
      this.limitButtons.push(option);
      limits.append(option);
    }
    scanRow.append(this.scanButton, limits);
    const checks = element('div', 'ppp-c-checks');
    this.skipAdsInput = this.toggle(checks, 'Skip ads');
    this.skipRepeatsInput = this.toggle(checks, 'Skip repeats');
    this.forgetButton = element('button', 'ppp-c-link');
    this.forgetButton.type = 'button';
    this.forgetButton.title = 'Let a scan collect pins it skipped as seen before';
    checks.append(this.forgetButton);
    scanCard.append(scanRow, checks);

    // Folders
    this.folders = element('nav', 'ppp-c-folders');
    this.folders.setAttribute('aria-label', 'Folders');

    // Filters
    const filterCard = element('section', 'ppp-c-section ppp-c-card ppp-c-filters');
    filterCard.setAttribute('aria-label', 'Filters');
    // Two lines instead of three labelled rows: the panel's height belongs to the pins.
    const filterLine = element('div', 'ppp-c-filter-line');
    const kinds = element('div', 'ppp-c-seg');
    kinds.dataset.size = 'small';
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', 'Type');
    for (const kind of ['all', 'image', 'video'] as const) {
      const option = element('button', '', KIND_LABEL[kind]);
      option.type = 'button';
      option.dataset.kind = kind;
      this.kindButtons.push(option);
      kinds.append(option);
    }
    const shapes = element('div', 'ppp-c-seg');
    shapes.dataset.size = 'small';
    shapes.dataset.icons = 'true';
    shapes.setAttribute('role', 'group');
    shapes.setAttribute('aria-label', 'Shape');
    for (const shape of SHAPES) {
      const option = element('button');
      option.type = 'button';
      option.dataset.shape = shape;
      option.innerHTML = SHAPE_ICON[shape];
      option.setAttribute('aria-label', SHAPE_LABEL[shape]);
      option.title = SHAPE_LABEL[shape];
      this.shapeButtons.push(option);
      shapes.append(option);
    }
    filterLine.append(kinds, shapes);
    const swatches = element('div', 'ppp-c-swatches');
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', 'Colour');
    for (const hue of HUES) {
      const swatch = element('button', 'ppp-c-swatch');
      swatch.type = 'button';
      swatch.dataset.hue = hue;
      swatch.style.background = HUE_SWATCH[hue];
      swatch.setAttribute('aria-label', HUE_LABEL[hue]);
      swatch.title = HUE_LABEL[hue];
      this.hueButtons.push(swatch);
      swatches.append(swatch);
    }
    filterCard.append(filterLine, swatches);

    // Status
    const status = element('div', 'ppp-c-status');
    this.statusText = element('span');
    this.statusText.setAttribute('aria-live', 'polite');
    this.statusActions = element('span', 'ppp-c-status-actions');
    status.append(this.statusText, this.statusActions);

    // Grid
    this.scroll = element('div', 'ppp-c-scroll');
    this.grid = element('div', 'ppp-c-grid');
    this.grid.setAttribute('role', 'list');
    this.grid.setAttribute('aria-label', 'Collected pins');
    this.empty = element('div', 'ppp-c-empty');
    this.scroll.append(this.grid, this.empty);

    // Footer
    const foot = element('footer', 'ppp-c-foot');
    this.selectionBar = element('div', 'ppp-c-selection');
    this.selectionText = element('span');
    const clearSelection = element('button', 'ppp-c-link', 'Clear');
    clearSelection.type = 'button';
    this.moveSelect = element('select', 'ppp-c-select');
    this.moveSelect.setAttribute('aria-label', 'Move selected pins to a folder');
    const removeSelected = element('button', 'ppp-c-link', 'Remove');
    removeSelected.type = 'button';
    removeSelected.dataset.danger = 'true';
    this.selectionBar.append(this.selectionText, clearSelection, removeSelected, this.moveSelect);

    const downloadRow = element('div', 'ppp-c-foot-row');
    const formats = element('div', 'ppp-c-seg');
    formats.setAttribute('role', 'group');
    formats.setAttribute('aria-label', 'Save as');
    for (const format of ['zip', 'files'] as const) {
      const option = element('button', '', format === 'zip' ? 'ZIP' : 'Files');
      option.type = 'button';
      option.dataset.format = format;
      option.title = format === 'zip' ? 'One archive, with a list of sources' : 'Each pin as its own file, videos included';
      this.formatButtons.push(option);
      formats.append(option);
    }
    this.downloadButton = element('button', 'ppp-c-primary ppp-c-grow');
    this.downloadButton.type = 'button';
    downloadRow.append(formats, this.downloadButton);
    const creditsRow = element('div', 'ppp-c-checks');
    this.creditsInput = this.toggle(creditsRow, 'Add sources.csv with each pin\'s link');

    this.busy = element('div', 'ppp-c-busy');
    this.busy.hidden = true;
    this.busy.setAttribute('role', 'status');
    const busyLine = element('div', 'ppp-c-busy-text');
    this.busyText = element('span');
    this.busyCount = element('span');
    busyLine.append(this.busyText, this.busyCount);
    const bar = element('div', 'ppp-c-bar');
    this.busyBar = element('span');
    bar.append(this.busyBar);
    const busyFoot = element('div', 'ppp-c-foot-row');
    this.busyCancel = element('button', 'ppp-c-link', 'Stop');
    this.busyCancel.type = 'button';
    busyFoot.append(this.busyCancel);
    this.busy.append(busyLine, bar, busyFoot);
    this.note = element('p', 'ppp-c-note');
    this.note.setAttribute('aria-live', 'polite');
    foot.append(this.selectionBar, downloadRow, creditsRow, this.busy, this.note);

    this.panel.append(head, scanCard, this.folders, filterCard, status, this.scroll, foot);
    // Under the toast and the media picker, which open above it.
    layer.prepend(this.panel);

    this.launcher.addEventListener('click', () => this.toggleOpen());
    close.addEventListener('click', () => this.close());
    this.scanButton.addEventListener('click', () => this.scanning ? this.scanning.abort() : void this.scan());
    for (const option of this.limitButtons) {
      option.addEventListener('click', () => {
        this.scanLimit = Number(option.dataset.limit) || DEFAULT_SCAN_LIMIT;
        this.render();
      });
    }
    this.skipAdsInput.addEventListener('change', () => this.savePrefs({ skipAds: this.skipAdsInput.checked }));
    this.skipRepeatsInput.addEventListener('change', () => this.savePrefs({ skipRepeats: this.skipRepeatsInput.checked }));
    this.forgetButton.addEventListener('click', () => {
      this.store.forgetSeen();
      this.setNote('Forgot the pins seen before. A scan can collect them again.');
    });
    for (const option of this.kindButtons) {
      option.addEventListener('click', () => {
        this.filters = { ...this.filters, kind: option.dataset.kind as KindFilter };
        this.render();
      });
    }
    for (const option of this.shapeButtons) {
      option.addEventListener('click', () => {
        this.filters = { ...this.filters, shapes: this.flip(this.filters.shapes, option.dataset.shape as Shape) };
        this.render();
      });
    }
    for (const swatch of this.hueButtons) {
      swatch.addEventListener('click', () => {
        this.filters = { ...this.filters, hues: this.flip(this.filters.hues, swatch.dataset.hue as Hue) };
        this.render();
      });
    }
    this.grid.addEventListener('click', this.onGridClick);
    clearSelection.addEventListener('click', () => {
      this.selected.clear();
      this.render();
    });
    removeSelected.addEventListener('click', () => {
      const count = this.selected.size;
      this.store.remove(this.selected);
      this.selected.clear();
      this.setNote(`Removed ${plural(count, 'pin')}.`);
    });
    this.moveSelect.addEventListener('change', () => this.onMove());
    for (const option of this.formatButtons) {
      option.addEventListener('click', () => this.savePrefs({ exportFormat: option.dataset.format as ExportFormat }));
    }
    this.creditsInput.addEventListener('change', () => this.savePrefs({ includeCredits: this.creditsInput.checked }));
    this.downloadButton.addEventListener('click', () => void this.download());
    this.busyCancel.addEventListener('click', () => {
      this.scanning?.abort();
      this.exporting?.abort();
    });
    // Pinterest binds keyboard shortcuts on the document; typing a folder name must not trigger them.
    this.panel.addEventListener('keydown', this.onKeyDown);
    this.panel.addEventListener('keyup', (event) => event.stopPropagation());
    this.panel.addEventListener('keypress', (event) => event.stopPropagation());

    this.unsubscribe = store.subscribe(() => this.queueRender());
    this.render();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.panel.hidden = false;
    this.layer.dataset.collectionOpen = 'true';
    this.launcher.setAttribute('aria-expanded', 'true');
    this.palettes.fill();
    this.render();
    window.requestAnimationFrame(() => this.scanButton.focus({ preventScroll: true }));
  }

  close(): void {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    delete this.layer.dataset.collectionOpen;
    this.launcher.setAttribute('aria-expanded', 'false');
    this.nameMode = null;
    if (this.panel.contains(this.activeElement())) this.launcher.focus({ preventScroll: true });
  }

  /** Focus inside the extension's shadow root, which `document.activeElement` cannot see into. */
  private activeElement(): Element | null {
    const root = this.layer.getRootNode();
    return root instanceof ShadowRoot ? root.activeElement : document.activeElement;
  }

  toggleOpen(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  setPrefs(prefs: CollectionPrefs): void {
    this.prefs = prefs;
    this.render();
  }

  /** Measures colours for pins added from outside the panel, by the buttons on pins. */
  measureNew(): void {
    this.palettes.fill();
  }

  destroy(): void {
    this.scanning?.abort();
    this.exporting?.abort();
    this.palettes.stop();
    this.unsubscribe();
    if (this.armed) window.clearTimeout(this.armed.timer);
    this.panel.remove();
    this.launcher.remove();
  }

  private toggle(parent: HTMLElement, label: string): HTMLInputElement {
    const wrap = element('label', 'ppp-c-check');
    const input = element('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    wrap.append(input, element('span', '', label));
    parent.append(wrap);
    return input;
  }

  private flip<T>(values: readonly T[], value: T): T[] {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  }

  private savePrefs(change: Partial<CollectionPrefs>): void {
    this.prefs = { ...this.prefs, ...change };
    this.render();
    void writeCollectionPrefs(change).catch(() => this.setNote('Could not save to your Chrome profile.', true));
  }

  private setNote(message: string, error = false): void {
    this.note.textContent = message;
    this.note.dataset.error = String(error);
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    window.requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private folderName(id: string | null): string {
    return this.store.snapshot.folders.find((folder) => folder.id === id)?.name ?? '';
  }

  private render(): void {
    const state = this.store.snapshot;
    if (this.view !== ALL_VIEW && this.view !== UNFILED_VIEW && !state.folders.some((folder) => folder.id === this.view)) {
      this.view = ALL_VIEW;
    }
    const keys = new Set(state.pins.map((pin) => pin.key));
    for (const key of this.selected) if (!keys.has(key)) this.selected.delete(key);

    const total = state.pins.length;
    this.launchCount.textContent = String(total);
    this.launchCount.dataset.empty = String(total === 0);
    this.launcher.setAttribute('aria-label', `Open your collection, ${plural(total, 'pin')}`);
    this.subtitle.textContent = `${plural(total, 'pin')} · ${plural(state.folders.length, 'folder')}`;
    if (!this.isOpen) return;

    const scanning = Boolean(this.scanning);
    this.scanButton.dataset.busy = String(scanning);
    this.scanButton.innerHTML = scanning
      ? `${ICONS.close}<span>Stop scanning</span>`
      : `${ICONS.scan}<span>Scan ${this.scanLimit} pins</span>`;
    this.scanButton.disabled = Boolean(this.exporting);
    for (const option of this.limitButtons) {
      option.setAttribute('aria-pressed', String(Number(option.dataset.limit) === this.scanLimit));
      option.disabled = scanning;
    }
    this.skipAdsInput.checked = this.prefs.skipAds;
    this.skipRepeatsInput.checked = this.prefs.skipRepeats;
    const forgettable = this.store.seenCount - total;
    this.forgetButton.hidden = !this.prefs.skipRepeats || forgettable <= 0;
    this.forgetButton.textContent = `Forget ${forgettable} seen`;

    this.renderFolders();

    for (const option of this.kindButtons) option.setAttribute('aria-pressed', String(option.dataset.kind === this.filters.kind));
    for (const option of this.shapeButtons) {
      option.setAttribute('aria-pressed', String(this.filters.shapes.includes(option.dataset.shape as Shape)));
    }
    for (const swatch of this.hueButtons) {
      swatch.setAttribute('aria-pressed', String(this.filters.hues.includes(swatch.dataset.hue as Hue)));
    }

    const { inFolder, shown } = visiblePins(state, this.view, this.filters);
    this.shown = shown;
    this.renderStatus(inFolder.length, shown.length);
    this.renderGrid(shown);
    this.renderEmpty(total, inFolder.length, shown.length);
    this.renderFooter(shown);
    if (this.palettesPending(state.pins)) this.palettes.fill();
  }

  private palettesPending(pins: readonly CollectedPin[]): boolean {
    return this.filters.hues.length > 0 && pins.some((pin) => pin.palette === null);
  }

  private renderFolders(): void {
    const state = this.store.snapshot;
    const counts = folderCounts(state);
    // A re-render while a folder name is being typed would throw the typing away.
    if (this.nameMode && this.folders.contains(this.activeElement())) return;
    const chips: HTMLElement[] = [];
    const chip = (view: FolderView, label: string, icon = '') => {
      const node = element('button', 'ppp-c-chip');
      node.type = 'button';
      node.dataset.view = view;
      node.setAttribute('aria-pressed', String(this.view === view));
      node.innerHTML = icon;
      node.append(element('span', '', label), element('b', '', String(counts.get(view) ?? 0)));
      node.addEventListener('click', () => {
        this.view = view;
        this.selected.clear();
        this.anchorKey = null;
        this.scroll.scrollTop = 0;
        this.render();
      });
      chips.push(node);
    };
    chip(ALL_VIEW, 'All');
    chip(UNFILED_VIEW, 'Unfiled');
    for (const folder of state.folders) {
      if (this.nameMode?.kind === 'rename' && this.nameMode.id === folder.id) {
        chips.push(this.nameInput(folder.name));
        continue;
      }
      chip(folder.id, folder.name, ICONS.folder);
    }
    if (this.nameMode && this.nameMode.kind !== 'rename') {
      chips.push(this.nameInput(''));
    } else {
      const add = iconButton('ppp-c-chip', 'New folder', ICONS.plus);
      add.dataset.add = 'true';
      add.addEventListener('click', () => {
        this.nameMode = { kind: 'create' };
        this.render();
      });
      chips.push(add);
    }
    this.folders.replaceChildren(...chips);
    const input = this.folders.querySelector<HTMLInputElement>('.ppp-c-name');
    if (input) {
      input.focus({ preventScroll: true });
      input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else {
      this.folders.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  private nameInput(value: string): HTMLInputElement {
    const input = element('input', 'ppp-c-name');
    input.type = 'text';
    input.value = value;
    input.maxLength = 40;
    input.placeholder = 'Folder name';
    input.setAttribute('aria-label', 'Folder name');
    let settled = false;
    const finish = (commit: boolean) => {
      if (settled) return;
      settled = true;
      const mode = this.nameMode;
      this.nameMode = null;
      if (commit && mode && input.value.trim()) this.commitName(mode, input.value);
      this.render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    if (value) window.requestAnimationFrame(() => input.select());
    return input;
  }

  private commitName(mode: NameMode, name: string): void {
    if (mode.kind === 'rename') {
      this.store.renameFolder(mode.id, name);
      return;
    }
    const folder = this.store.createFolder(name);
    if (!folder) {
      this.setNote('Could not add the folder: there are already 40.', true);
      return;
    }
    if (mode.kind === 'move' && this.selected.size > 0) {
      const count = this.selected.size;
      this.store.move(this.selected, folder.id);
      this.selected.clear();
      this.setNote(`Moved ${plural(count, 'pin')} to ${folder.name}.`);
    }
    this.view = folder.id;
  }

  private renderStatus(inFolder: number, shown: number): void {
    const filtering = isFiltering(this.filters);
    this.statusText.textContent = filtering
      ? `${shown} of ${inFolder} shown`
      : plural(inFolder, 'pin');
    const actions: HTMLElement[] = [];
    if (filtering) actions.push(this.linkButton('Reset filters', () => {
      this.filters = { ...EMPTY_FILTERS, shapes: [], hues: [] };
      this.render();
    }));
    const folder = this.store.snapshot.folders.find((item) => item.id === this.view);
    if (folder) {
      actions.push(this.linkButton('Rename', () => {
        this.nameMode = { kind: 'rename', id: folder.id };
        this.render();
      }));
      actions.push(this.armedButton('Delete folder', `Delete ${folder.name}?`, () => {
        this.store.deleteFolder(folder.id);
        this.view = ALL_VIEW;
        this.setNote(`Deleted the folder. Its pins are now unfiled.`);
      }));
    } else if (inFolder > 0 && !filtering) {
      actions.push(this.armedButton(
        this.view === ALL_VIEW ? 'Remove all' : 'Remove these',
        `Remove ${inFolder}?`,
        () => {
          const keys = visiblePins(this.store.snapshot, this.view, EMPTY_FILTERS).inFolder.map((pin) => pin.key);
          this.store.remove(keys);
          this.selected.clear();
          this.setNote(`Removed ${plural(keys.length, 'pin')}.`);
        },
      ));
    }
    // Rebuilding would drop an armed button's second click, so keep it while armed.
    if (this.armed && this.statusActions.contains(this.armed.button)) return;
    this.statusActions.replaceChildren(...actions);
  }

  private linkButton(label: string, run: () => void): HTMLButtonElement {
    const node = element('button', 'ppp-c-link', label);
    node.type = 'button';
    node.addEventListener('click', run);
    return node;
  }

  /** A destructive action asks for a second click instead of a dialog that would block the page. */
  private armedButton(label: string, confirm: string, run: () => void): HTMLButtonElement {
    const node = this.linkButton(label, () => {
      if (this.armed?.button === node) {
        window.clearTimeout(this.armed.timer);
        this.armed = null;
        run();
        this.render();
        return;
      }
      if (this.armed) this.disarm();
      node.textContent = confirm;
      node.dataset.armed = 'true';
      this.armed = { button: node, timer: window.setTimeout(() => this.disarm(), ARM_MS) };
    });
    node.dataset.danger = 'true';
    node.dataset.label = label;
    return node;
  }

  private disarm(): void {
    if (!this.armed) return;
    const { button, timer } = this.armed;
    window.clearTimeout(timer);
    button.textContent = button.dataset.label ?? '';
    delete button.dataset.armed;
    this.armed = null;
    this.render();
  }

  private tileFor(pin: CollectedPin): HTMLElement {
    const existing = this.tiles.get(pin.key);
    if (existing) return existing;
    const item = element('div', 'ppp-c-item');
    item.setAttribute('role', 'listitem');
    item.dataset.key = pin.key;
    const tile = element('button', 'ppp-c-tile');
    tile.type = 'button';
    tile.dataset.key = pin.key;
    const label = pin.title || (pin.kind === 'video' ? 'Video pin' : 'Image pin');
    tile.setAttribute('aria-label', label);
    tile.title = pin.title;
    const image = element('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    if (pin.ratio > 0) image.style.aspectRatio = String(pin.ratio);
    image.src = pin.previewUrl;
    const tick = element('span', 'ppp-c-tick');
    tick.innerHTML = ICONS.check;
    tile.append(image, tick);
    if (pin.kind === 'video') tile.append(element('span', 'ppp-c-badge', 'Video'));
    item.append(tile);
    const url = pinUrl(pin);
    if (url) {
      const open = element('a', 'ppp-c-open');
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener';
      open.title = 'Open pin';
      open.setAttribute('aria-label', `Open ${label} on Pinterest`);
      open.innerHTML = ICONS.external;
      item.append(open);
    }
    this.tiles.set(pin.key, item);
    return item;
  }

  private renderGrid(shown: CollectedPin[]): void {
    const order = shown.map((pin) => pin.key).join('\n');
    if (order !== this.shownOrder) {
      this.shownOrder = order;
      this.grid.replaceChildren(...shown.map((pin) => this.tileFor(pin)));
      const live = new Set(this.store.snapshot.pins.map((pin) => pin.key));
      for (const key of this.tiles.keys()) if (!live.has(key)) this.tiles.delete(key);
    }
    this.grid.dataset.selecting = String(this.selected.size > 0);
    for (const pin of shown) {
      const tile = this.tiles.get(pin.key)?.firstElementChild;
      if (tile) tile.setAttribute('aria-pressed', String(this.selected.has(pin.key)));
    }
  }

  private renderEmpty(total: number, inFolder: number, shown: number): void {
    this.empty.hidden = shown > 0;
    if (shown > 0) return;
    const [title, body] = total === 0
      ? ['Nothing collected yet', 'Scan this page to gather its pins, or use the bookmark button on any pin.']
      : inFolder === 0
        ? ['This folder is empty', 'Select pins in another folder and move them here, or scan while this folder is open.']
        : ['No pins match', 'Try fewer filters. Colours are measured a moment after a pin is added.'];
    this.empty.innerHTML = ICONS.collection;
    this.empty.append(element('strong', '', title), element('span', '', body));
  }

  private renderFooter(shown: CollectedPin[]): void {
    const state = this.store.snapshot;
    const selectedCount = this.selected.size;
    this.selectionBar.hidden = selectedCount === 0;
    this.selectionText.textContent = `${selectedCount} selected`;

    const options: HTMLOptionElement[] = [];
    const option = (value: string, label: string, disabled = false) => {
      const node = element('option', '', label);
      node.value = value;
      node.disabled = disabled;
      options.push(node);
    };
    option('', 'Move to…', true);
    option(UNFILED_OPTION, 'Unfiled');
    for (const folder of state.folders) option(folder.id, folder.name);
    option(NEW_FOLDER_OPTION, 'New folder…');
    this.moveSelect.replaceChildren(...options);
    this.moveSelect.value = '';

    for (const button of this.formatButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.format === this.prefs.exportFormat));
    }
    this.creditsInput.checked = this.prefs.includeCredits;
    this.creditsInput.disabled = this.prefs.exportFormat !== 'zip';
    this.creditsInput.closest('label')!.style.opacity = this.prefs.exportFormat === 'zip' ? '' : '.45';

    const targets = this.targets();
    this.downloadButton.disabled = targets.length === 0 || Boolean(this.exporting) || Boolean(this.scanning);
    this.downloadButton.innerHTML = `${ICONS.download}<span>${selectedCount > 0
      ? `Download ${selectedCount} selected`
      : shown.length === 0 ? 'Download' : `Download ${shown.length === 1 ? '1 pin' : `all ${shown.length}`}`}</span>`;
  }

  /** What a download saves: the selection, or everything the current view shows. */
  private targets(): CollectedPin[] {
    if (this.selected.size === 0) return this.shown;
    return this.store.snapshot.pins.filter((pin) => this.selected.has(pin.key));
  }

  private onGridClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.ppp-c-open')) return;
    const tile = target?.closest<HTMLElement>('.ppp-c-tile');
    const key = tile?.dataset.key;
    if (!key) return;
    if (event.shiftKey && this.anchorKey) {
      const keys = this.shown.map((pin) => pin.key);
      const from = keys.indexOf(this.anchorKey);
      const to = keys.indexOf(key);
      if (from !== -1 && to !== -1) {
        const selecting = !this.selected.has(key) || this.selected.has(this.anchorKey);
        for (const rangeKey of keys.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          if (selecting) this.selected.add(rangeKey);
          else this.selected.delete(rangeKey);
        }
      }
    } else if (this.selected.has(key)) {
      this.selected.delete(key);
    } else {
      this.selected.add(key);
    }
    this.anchorKey = key;
    this.render();
  };

  private onMove(): void {
    const value = this.moveSelect.value;
    if (!value || this.selected.size === 0) return;
    if (value === NEW_FOLDER_OPTION) {
      this.nameMode = { kind: 'move' };
      this.render();
      return;
    }
    const folderId = value === UNFILED_OPTION ? null : value;
    const count = this.selected.size;
    this.store.move(this.selected, folderId);
    this.selected.clear();
    this.setNote(`Moved ${plural(count, 'pin')} to ${folderId ? this.folderName(folderId) : 'Unfiled'}.`);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Escape' && !event.defaultPrevented) {
      if (this.selected.size > 0) {
        this.selected.clear();
        this.render();
      } else {
        this.close();
      }
      return;
    }
    const editing = event.target instanceof HTMLInputElement && event.target.type === 'text';
    if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      for (const pin of this.shown) this.selected.add(pin.key);
      this.render();
    }
  };

  private showBusy(text: string, done: number, total: number, cancellable: boolean): void {
    this.busy.hidden = false;
    this.busyText.textContent = text;
    this.busyCount.textContent = total > 0 ? `${done} / ${total}` : '';
    this.busyBar.style.width = total > 0 ? `${Math.min(100, (done / total) * 100)}%` : '0%';
    this.busyCancel.hidden = !cancellable;
  }

  private hideBusy(): void {
    this.busy.hidden = true;
  }

  private async scan(): Promise<void> {
    if (this.scanning || this.exporting) return;
    const controller = new AbortController();
    this.scanning = controller;
    const folderId = this.view !== ALL_VIEW && this.view !== UNFILED_VIEW ? this.view : null;
    const limit = this.scanLimit;
    let ads = 0;
    let repeats = 0;
    let full = 0;
    let remaining = limit;
    this.setNote('');
    this.render();
    this.showBusy('Scanning the page', 0, limit, true);
    try {
      const result = await scanPage({
        limit,
        signal: controller.signal,
        collect: (pins) => {
          const drafts: CollectedPin[] = [];
          for (const pin of pins) {
            if (drafts.length >= remaining) break;
            if (this.prefs.skipAds && isPromotedPin(pin)) {
              ads += 1;
              continue;
            }
            const draft = capturePin(pin);
            if (!draft || this.store.has(draft.key)) continue;
            if (this.prefs.skipRepeats && this.store.wasSeen(draft.key)) {
              repeats += 1;
              continue;
            }
            drafts.push(draft);
          }
          const added = this.store.add(drafts, { skipRepeats: this.prefs.skipRepeats, folderId });
          full += added.full;
          remaining -= added.added;
          // A full collection ends the scan: reporting the whole limit stops it.
          return full > 0 ? limit : added.added;
        },
        onProgress: ({ added, limit: total }) => this.showBusy('Scanning the page', added, total, true),
      });
      const added = limit - remaining;
      const skipped = [
        ads > 0 ? plural(ads, 'ad') : '',
        repeats > 0 ? plural(repeats, 'repeat') : '',
      ].filter(Boolean).join(' and ');
      const where = folderId ? ` to ${this.folderName(folderId)}` : '';
      const ending = full > 0
        ? ` The collection is full at ${MAX_COLLECTED_PINS}.`
        : result.reason === 'end' && added < limit ? ' That is the end of this feed.' : '';
      this.setNote(`Added ${plural(added, 'pin')}${where}.${skipped ? ` Skipped ${skipped}.` : ''}${ending}`, full > 0);
    } catch {
      this.setNote('The scan stopped unexpectedly.', true);
    } finally {
      this.scanning = null;
      this.hideBusy();
      this.palettes.fill();
      this.render();
    }
  }

  private archiveName(): string {
    const folder = this.folderName(this.view);
    const base = folder ? directoryName(folder, 'Pinterest-collection') : 'Pinterest-collection';
    return `${base}-${today()}`;
  }

  private async download(): Promise<void> {
    if (this.exporting || this.scanning) return;
    const pins = this.targets();
    if (pins.length === 0) return;
    if (this.prefs.exportFormat === 'zip' && pins.length > MAX_ARCHIVE_PINS) {
      this.setNote(`A ZIP holds up to ${MAX_ARCHIVE_PINS} pins. Select fewer, or save them as files.`, true);
      return;
    }
    const controller = new AbortController();
    this.exporting = controller;
    this.setNote('');
    this.render();
    try {
      if (this.prefs.exportFormat === 'zip') await this.downloadArchive(pins);
      else await this.downloadFiles(pins, controller.signal);
    } finally {
      this.exporting = null;
      this.hideBusy();
      this.render();
    }
  }

  /**
   * In the "All" view a pin goes into a subfolder named after its folder, so
   * the archive keeps the collection's shape; inside a folder, the folder is
   * the archive and the files sit at its top.
   */
  private subfolderFor(pin: CollectedPin): string {
    if (this.view !== ALL_VIEW || !pin.folderId) return '';
    const name = this.folderName(pin.folderId);
    return name ? directoryName(name, 'Folder') : '';
  }

  private downloadArchive(pins: CollectedPin[]): Promise<void> {
    const used = new Map<string, Set<string>>();
    const items: ArchiveItem[] = pins.map((pin) => {
      const subfolder = this.subfolderFor(pin);
      const names = used.get(subfolder) ?? new Set<string>();
      used.set(subfolder, names);
      const stem = exportStem(pin, names);
      return {
        kind: pin.kind,
        candidates: pin.candidates,
        streams: pin.streams,
        stem: subfolder ? `${subfolder}/${stem}` : stem,
        title: pin.title,
        pinUrl: pinUrl(pin),
      };
    });
    this.showBusy('Packing the ZIP', 0, items.length, false);
    return new Promise((resolve) => {
      let port: chrome.runtime.Port;
      try {
        port = browser.runtime.connect({ name: ARCHIVE_PORT }) as unknown as chrome.runtime.Port;
      } catch {
        this.setNote('The extension was updated. Reload this page to save.', true);
        resolve();
        return;
      }
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try {
          port.disconnect();
        } catch {
          // Already gone.
        }
        resolve();
      };
      port.onMessage.addListener((event: ArchiveEvent) => {
        if (event.type === 'ARCHIVE_PROGRESS') {
          this.showBusy(event.done < event.total ? 'Fetching originals' : 'Packing the ZIP', event.done, event.total, false);
          return;
        }
        this.setNote(event.message, !event.ok);
        if (event.ok && !this.isOpen) this.toast(event.message);
        finish();
      });
      port.onDisconnect.addListener(() => {
        if (!finished) this.setNote('The extension stopped before the ZIP was ready.', true);
        finish();
      });
      const request: ArchiveRequest = {
        type: 'BUILD_ARCHIVE',
        items,
        archiveName: this.archiveName(),
        includeCredits: this.prefs.includeCredits,
      };
      port.postMessage(request);
    });
  }

  private async downloadFiles(pins: CollectedPin[], signal: AbortSignal): Promise<void> {
    let next = 0;
    let done = 0;
    let saved = 0;
    const base = this.folderName(this.view);
    this.showBusy('Saving files', 0, pins.length, true);
    const worker = async () => {
      while (next < pins.length && !signal.aborted) {
        const pin = pins[next]!;
        next += 1;
        const folder = this.view === ALL_VIEW ? this.folderName(pin.folderId) : base;
        const source = pin.candidates[0] ?? pin.posterCandidates[0] ?? pin.streams[0] ?? '';
        const message: DownloadMediaMessage = {
          type: 'DOWNLOAD_MEDIA',
          kind: pin.kind,
          candidates: pin.candidates,
          streams: pin.streams,
          suggestedName: `${exportStem(pin, new Set())}.${exportExtension(source, pin.kind)}`,
          directory: `Pinterest/${directoryName(folder, 'Collection')}`,
        };
        try {
          const response = await withTimeout(browser.runtime.sendMessage(message), FILE_TIMEOUT_MS, 'Timed out');
          if (isActionResponse(response) && response.ok) saved += 1;
        } catch {
          // Counted as not saved below.
        }
        done += 1;
        this.showBusy('Saving files', done, pins.length, true);
      }
    };
    await Promise.all(Array.from({ length: Math.min(FILE_CONCURRENCY, pins.length) }, worker));
    const failed = done - saved;
    const message = signal.aborted
      ? `Stopped after ${plural(saved, 'file')}.`
      : failed > 0
        ? `Saved ${saved} of ${pins.length}. Pinterest did not serve ${failed}.`
        : `Saved ${plural(saved, 'file')}.`;
    this.setNote(message, failed > 0 && saved === 0);
    if (saved > 0 && !this.isOpen) this.toast(message);
  }
}
