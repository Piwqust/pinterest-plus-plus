import {
  MAX_COLLECTED_PINS,
  MAX_FOLDERS,
  cleanFolderName,
  compactPin,
  normalizeCollection,
  type CollectedPin,
  type CollectionState,
  type Folder,
  type HueShare,
} from './collection';

/**
 * Local, not synced: a collection is hundreds of addresses, far past what
 * Chrome Sync accepts per item, and it belongs to this machine's downloads.
 */
export const COLLECTION_KEY = 'collection';
/** Keys of every pin ever collected, so a scan can skip what was already seen. */
export const SEEN_KEY = 'collectionSeen';
const MAX_SEEN = 10_000;
const WRITE_DEBOUNCE = 250;

type Listener = (state: CollectionState) => void;

export interface AddResult {
  added: number;
  /** Already in the collection. */
  present: number;
  /** Collected once before and skipped for it. */
  repeats: number;
  /** Left out because the collection is full. */
  full: number;
}

function newId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * The collection as this tab sees it. Every Pinterest tab holds one; a write
 * from any of them reaches the others through `storage.onChanged`, so a tab
 * adopts the newer state before it next changes anything.
 */
export class CollectionStore {
  private listeners = new Set<Listener>();
  private writeTimer: number | undefined;
  /** What this tab last wrote, to tell its own echo from another tab's change. */
  private written: string | null = null;

  private constructor(private state: CollectionState, private seen: Set<string>) {}

  static async open(): Promise<CollectionStore> {
    try {
      const stored = await browser.storage.local.get([COLLECTION_KEY, SEEN_KEY]);
      const seen = Array.isArray(stored[SEEN_KEY]) ? stored[SEEN_KEY].filter((key): key is string => typeof key === 'string') : [];
      return new CollectionStore(normalizeCollection(stored[COLLECTION_KEY]), new Set(seen));
    } catch {
      return new CollectionStore({ pins: [], folders: [] }, new Set());
    }
  }

  get snapshot(): CollectionState {
    return this.state;
  }

  get seenCount(): number {
    return this.seen.size;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  has(key: string | null): boolean {
    return Boolean(key) && this.state.pins.some((pin) => pin.key === key);
  }

  wasSeen(key: string): boolean {
    return this.seen.has(key);
  }

  add(drafts: readonly CollectedPin[], options: { skipRepeats?: boolean; folderId?: string | null } = {}): AddResult {
    const result: AddResult = { added: 0, present: 0, repeats: 0, full: 0 };
    const keys = new Set(this.state.pins.map((pin) => pin.key));
    const folderId = options.folderId && this.state.folders.some((folder) => folder.id === options.folderId)
      ? options.folderId
      : null;
    const fresh: CollectedPin[] = [];
    for (const draft of drafts) {
      if (keys.has(draft.key)) {
        result.present += 1;
        continue;
      }
      if (options.skipRepeats && this.seen.has(draft.key)) {
        result.repeats += 1;
        continue;
      }
      if (this.state.pins.length + fresh.length >= MAX_COLLECTED_PINS) {
        result.full += 1;
        continue;
      }
      keys.add(draft.key);
      this.seen.add(draft.key);
      fresh.push(compactPin({ ...draft, folderId: folderId ?? draft.folderId }));
    }
    result.added = fresh.length;
    if (fresh.length > 0) this.commit({ ...this.state, pins: [...this.state.pins, ...fresh] }, true);
    return result;
  }

  remove(keys: Iterable<string>): void {
    const removing = new Set(keys);
    if (removing.size === 0) return;
    this.commit({ ...this.state, pins: this.state.pins.filter((pin) => !removing.has(pin.key)) });
  }

  clear(): void {
    this.commit({ ...this.state, pins: [] });
  }

  move(keys: Iterable<string>, folderId: string | null): void {
    const moving = new Set(keys);
    const target = folderId && this.state.folders.some((folder) => folder.id === folderId) ? folderId : null;
    this.commit({
      ...this.state,
      pins: this.state.pins.map((pin) => moving.has(pin.key) ? { ...pin, folderId: target } : pin),
    });
  }

  setPalette(key: string, palette: HueShare[]): void {
    const index = this.state.pins.findIndex((pin) => pin.key === key);
    if (index === -1) return;
    const pins = [...this.state.pins];
    pins[index] = { ...pins[index]!, palette };
    this.commit({ ...this.state, pins });
  }

  createFolder(name: string): Folder | null {
    const clean = cleanFolderName(name);
    if (!clean || this.state.folders.length >= MAX_FOLDERS) return null;
    const existing = this.state.folders.find((folder) => folder.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    const folder: Folder = { id: newId(), name: clean, createdAt: Date.now() };
    this.commit({ ...this.state, folders: [...this.state.folders, folder] });
    return folder;
  }

  renameFolder(id: string, name: string): void {
    const clean = cleanFolderName(name);
    if (!clean) return;
    this.commit({
      ...this.state,
      folders: this.state.folders.map((folder) => folder.id === id ? { ...folder, name: clean } : folder),
    });
  }

  /** The folder goes; its pins stay, unfiled. */
  deleteFolder(id: string): void {
    this.commit({
      pins: this.state.pins.map((pin) => pin.folderId === id ? { ...pin, folderId: null } : pin),
      folders: this.state.folders.filter((folder) => folder.id !== id),
    });
  }

  forgetSeen(): void {
    this.seen = new Set(this.state.pins.map((pin) => pin.key));
    this.queueWrite(true);
    this.emit();
  }

  /** Adopts a collection another tab, or the popup, wrote. */
  onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (area !== 'local') return;
    let changed = false;
    const collection = changes[COLLECTION_KEY];
    if (collection) {
      const serialized = JSON.stringify(collection.newValue ?? null);
      if (serialized !== this.written) {
        this.state = normalizeCollection(collection.newValue);
        changed = true;
      }
    }
    const seen = changes[SEEN_KEY];
    if (seen && Array.isArray(seen.newValue)) {
      this.seen = new Set(seen.newValue.filter((key): key is string => typeof key === 'string'));
    }
    if (changed) this.emit();
  };

  destroy(): void {
    if (this.writeTimer !== undefined) {
      window.clearTimeout(this.writeTimer);
      this.flush(true);
    }
    this.listeners.clear();
  }

  private commit(state: CollectionState, seenChanged = false): void {
    this.state = state;
    this.queueWrite(seenChanged);
    this.emit();
  }

  private pendingSeen = false;

  /** A scan adds pins in bursts; one write per burst stays inside storage's rate limits. */
  private queueWrite(seenChanged: boolean): void {
    this.pendingSeen ||= seenChanged;
    if (this.writeTimer !== undefined) window.clearTimeout(this.writeTimer);
    this.writeTimer = window.setTimeout(() => this.flush(this.pendingSeen), WRITE_DEBOUNCE);
  }

  private flush(withSeen: boolean): void {
    this.writeTimer = undefined;
    this.pendingSeen = false;
    const value: Record<string, unknown> = { [COLLECTION_KEY]: this.state };
    if (withSeen) value[SEEN_KEY] = [...this.seen].slice(-MAX_SEEN);
    this.written = JSON.stringify(this.state);
    void browser.storage.local.set(value).catch(() => undefined);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
