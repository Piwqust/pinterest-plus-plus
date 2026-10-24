import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectedPin } from '../shared/collection';
import { COLLECTION_KEY, CollectionStore, SEEN_KEY } from '../shared/collection-store';

function pin(key: string, overrides: Partial<CollectedPin> = {}): CollectedPin {
  return {
    key,
    pinId: key,
    title: '',
    kind: 'image',
    previewUrl: 'https://i.pinimg.com/236x/a.jpg',
    candidates: ['https://i.pinimg.com/originals/a.jpg'],
    streams: [],
    posterCandidates: [],
    ratio: 1,
    palette: null,
    folderId: null,
    addedAt: 1,
    ...overrides,
  };
}

let stored: Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  stored = {};
  (globalThis as Record<string, unknown>).browser = {
    storage: {
      local: {
        get: async () => ({ ...stored }),
        set: async (value: Record<string, unknown>) => { Object.assign(stored, value); },
      },
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).browser;
});

describe('collection store', () => {
  it('adds new pins once and reports the rest', async () => {
    const store = await CollectionStore.open();
    expect(store.add([pin('1'), pin('2')])).toMatchObject({ added: 2, present: 0 });
    expect(store.add([pin('2'), pin('3')])).toMatchObject({ added: 1, present: 1 });
    expect(store.snapshot.pins.map(({ key }) => key)).toEqual(['1', '2', '3']);
  });

  it('writes once per burst, with the pins it has seen', async () => {
    const store = await CollectionStore.open();
    store.add([pin('1')]);
    store.add([pin('2')]);
    expect(stored[COLLECTION_KEY]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    expect((stored[COLLECTION_KEY] as { pins: unknown[] }).pins).toHaveLength(2);
    expect(stored[SEEN_KEY]).toEqual(['1', '2']);
  });

  it('skips repeats only when asked, and forgets them on request', async () => {
    const store = await CollectionStore.open();
    store.add([pin('1')]);
    store.remove(['1']);
    expect(store.add([pin('1')], { skipRepeats: true })).toMatchObject({ added: 0, repeats: 1 });
    store.forgetSeen();
    expect(store.add([pin('1')], { skipRepeats: true })).toMatchObject({ added: 1 });
  });

  it('files new pins into an existing folder and unfiles them when it goes', async () => {
    const store = await CollectionStore.open();
    const folder = store.createFolder('  Moodboard ')!;
    expect(folder.name).toBe('Moodboard');
    expect(store.createFolder('moodboard')!.id).toBe(folder.id);
    store.add([pin('1')], { folderId: folder.id });
    store.add([pin('2')], { folderId: 'missing' });
    expect(store.snapshot.pins.map(({ folderId }) => folderId)).toEqual([folder.id, null]);
    store.move(['2'], folder.id);
    store.deleteFolder(folder.id);
    expect(store.snapshot.folders).toEqual([]);
    expect(store.snapshot.pins.every(({ folderId }) => folderId === null)).toBe(true);
  });

  it('adopts a collection another tab wrote, but not its own echo', async () => {
    const store = await CollectionStore.open();
    const seen: number[] = [];
    store.subscribe((state) => seen.push(state.pins.length));
    store.add([pin('1')]);
    await vi.advanceTimersByTimeAsync(300);
    store.onStorageChanged({ [COLLECTION_KEY]: { newValue: stored[COLLECTION_KEY] } }, 'local');
    expect(seen).toEqual([1]);
    store.onStorageChanged({ [COLLECTION_KEY]: { newValue: { pins: [pin('1'), pin('9')], folders: [] } } }, 'local');
    expect(seen).toEqual([1, 2]);
    expect(store.has('9')).toBe(true);
  });

  it('opens empty when storage is unavailable', async () => {
    (globalThis as Record<string, unknown>).browser = { storage: { local: { get: async () => { throw new Error('no'); } } } };
    expect((await CollectionStore.open()).snapshot).toEqual({ pins: [], folders: [] });
  });
});
