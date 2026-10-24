import { describe, expect, it } from 'vitest';
import {
  ALL_VIEW,
  EMPTY_FILTERS,
  MAX_COLLECTED_PINS,
  UNFILED_VIEW,
  cleanFolderName,
  creditsCsv,
  directoryName,
  exportStem,
  folderCounts,
  isFiltering,
  matchesFilters,
  normalizeCollection,
  paletteFromPixels,
  pinKey,
  shapeOf,
  visiblePins,
  type CollectedPin,
  type CollectionState,
} from '../shared/collection';

function pin(overrides: Partial<CollectedPin> = {}): CollectedPin {
  return {
    key: '1',
    pinId: '1',
    title: 'A pin',
    kind: 'image',
    previewUrl: 'https://i.pinimg.com/236x/aa/bb/a.jpg',
    candidates: ['https://i.pinimg.com/originals/aa/bb/a.jpg'],
    streams: [],
    posterCandidates: [],
    ratio: 0.75,
    palette: [{ hue: 'red', share: 0.6 }, { hue: 'mono', share: 0.4 }],
    folderId: null,
    addedAt: 1,
    ...overrides,
  };
}

/** RGBA pixels, `count` of each colour. */
function pixels(...runs: Array<[number, number, number, number]>): number[] {
  return runs.flatMap(([r, g, b, count]) => Array.from({ length: count }, () => [r, g, b, 255]).flat());
}

describe('shapes', () => {
  it('reads portrait, square and landscape from the ratio', () => {
    expect(shapeOf(0.66)).toBe('portrait');
    expect(shapeOf(1)).toBe('square');
    expect(shapeOf(1.05)).toBe('square');
    expect(shapeOf(1.78)).toBe('landscape');
  });

  it('has no shape for a picture that was never measured', () => {
    expect(shapeOf(0)).toBeNull();
    expect(shapeOf(Number.NaN)).toBeNull();
  });
});

describe('pin keys', () => {
  it('prefers the pin id and falls back to the media', () => {
    expect(pinKey('42', ['https://i.pinimg.com/a.jpg'])).toBe('42');
    expect(pinKey(null, ['', 'https://i.pinimg.com/a.jpg'])).toBe('m:https://i.pinimg.com/a.jpg');
    expect(pinKey(null, [])).toBeNull();
  });
});

describe('colour palettes', () => {
  it('names every colour that covers a fair share, largest first', () => {
    const palette = paletteFromPixels(pixels([220, 30, 30, 60], [30, 60, 220, 40]));
    expect(palette.map(({ hue }) => hue)).toEqual(['red', 'blue']);
    expect(palette[0]!.share).toBeCloseTo(0.6, 1);
  });

  it('counts washed-out, near-black and near-white pixels as mono, at a lower weight', () => {
    const palette = paletteFromPixels(pixels([250, 250, 250, 50], [20, 160, 60, 50]));
    expect(palette[0]!.hue).toBe('green');
    expect(palette.find(({ hue }) => hue === 'mono')!.share).toBeLessThan(0.5);
  });

  it('ignores transparent pixels and drops slivers', () => {
    const transparent = [255, 0, 0, 0];
    const palette = paletteFromPixels([...transparent, ...pixels([240, 200, 20, 97], [140, 60, 200, 3])]);
    expect(palette.map(({ hue }) => hue)).toEqual(['yellow']);
  });

  it('returns nothing for an empty picture', () => {
    expect(paletteFromPixels([])).toEqual([]);
  });
});

describe('filters', () => {
  it('matches every pin when nothing is filtered', () => {
    expect(isFiltering(EMPTY_FILTERS)).toBe(false);
    expect(matchesFilters(pin(), EMPTY_FILTERS)).toBe(true);
  });

  it('filters by type and shape', () => {
    expect(matchesFilters(pin(), { ...EMPTY_FILTERS, kind: 'video' })).toBe(false);
    expect(matchesFilters(pin({ kind: 'video' }), { ...EMPTY_FILTERS, kind: 'video' })).toBe(true);
    expect(matchesFilters(pin({ ratio: 1.6 }), { ...EMPTY_FILTERS, shapes: ['portrait', 'square'] })).toBe(false);
    expect(matchesFilters(pin({ ratio: 1 }), { ...EMPTY_FILTERS, shapes: ['portrait', 'square'] })).toBe(true);
    expect(matchesFilters(pin({ ratio: 0 }), { ...EMPTY_FILTERS, shapes: ['portrait'] })).toBe(false);
  });

  it('matches a colour that covers enough of the picture, not a trace of it', () => {
    const trace = pin({ palette: [{ hue: 'blue', share: 0.9 }, { hue: 'red', share: 0.08 }] });
    expect(matchesFilters(pin(), { ...EMPTY_FILTERS, hues: ['red'] })).toBe(true);
    expect(matchesFilters(trace, { ...EMPTY_FILTERS, hues: ['red'] })).toBe(false);
    expect(matchesFilters(trace, { ...EMPTY_FILTERS, hues: ['red', 'blue'] })).toBe(true);
  });

  it('leaves an unmeasured pin out of a colour filter until it is measured', () => {
    expect(matchesFilters(pin({ palette: null }), { ...EMPTY_FILTERS, hues: ['red'] })).toBe(false);
    expect(matchesFilters(pin({ palette: null }), EMPTY_FILTERS)).toBe(true);
  });
});

describe('folders and views', () => {
  const state: CollectionState = {
    folders: [{ id: 'f1', name: 'Moodboard', createdAt: 1 }],
    pins: [
      pin({ key: 'a', addedAt: 1 }),
      pin({ key: 'b', addedAt: 3, folderId: 'f1' }),
      pin({ key: 'c', addedAt: 2, kind: 'video' }),
    ],
  };

  it('lists a view newest first, with what the filters hide', () => {
    const all = visiblePins(state, ALL_VIEW, { ...EMPTY_FILTERS, kind: 'image' });
    expect(all.inFolder.map(({ key }) => key)).toEqual(['b', 'c', 'a']);
    expect(all.shown.map(({ key }) => key)).toEqual(['b', 'a']);
    expect(visiblePins(state, UNFILED_VIEW, EMPTY_FILTERS).inFolder.map(({ key }) => key)).toEqual(['c', 'a']);
    expect(visiblePins(state, 'f1', EMPTY_FILTERS).inFolder.map(({ key }) => key)).toEqual(['b']);
  });

  it('counts each view', () => {
    const counts = folderCounts(state);
    expect(counts.get(ALL_VIEW)).toBe(3);
    expect(counts.get(UNFILED_VIEW)).toBe(2);
    expect(counts.get('f1')).toBe(1);
  });

  it('cleans folder names', () => {
    expect(cleanFolderName('  Kitchen\n  ideas ')).toBe('Kitchen ideas');
    expect(cleanFolderName('x'.repeat(80))).toHaveLength(40);
  });
});

describe('reading stored collections', () => {
  it('keeps what fits and drops what does not', () => {
    const state = normalizeCollection({
      folders: [{ id: 'f1', name: 'Moodboard' }, { id: 'f1', name: 'Duplicate' }, { id: '', name: 'No id' }],
      pins: [
        pin({ key: 'a', folderId: 'f1' }),
        pin({ key: 'a' }),
        pin({ key: 'b', folderId: 'missing' }),
        { ...pin({ key: 'c' }), candidates: ['javascript:alert(1)'], posterCandidates: [], streams: [] },
        { key: 'd', palette: [{ hue: 'chartreuse', share: 0.5 }], candidates: ['https://i.pinimg.com/a.jpg'] },
        'nonsense',
      ],
    });
    expect(state.folders.map(({ id }) => id)).toEqual(['f1']);
    expect(state.pins.map(({ key }) => key)).toEqual(['a', 'b', 'd']);
    expect(state.pins[1]!.folderId).toBeNull();
    expect(state.pins[2]!.palette).toEqual([]);
    expect(state.pins[2]!.kind).toBe('image');
  });

  it('reads nothing at all as an empty collection', () => {
    expect(normalizeCollection(undefined)).toEqual({ pins: [], folders: [] });
  });

  it('never holds more than the cap', () => {
    const pins = Array.from({ length: MAX_COLLECTED_PINS + 5 }, (_, index) => pin({ key: String(index) }));
    expect(normalizeCollection({ pins }).pins).toHaveLength(MAX_COLLECTED_PINS);
  });
});

describe('export names', () => {
  it('names files after the pin, unique within the batch', () => {
    const used = new Set<string>();
    expect(exportStem(pin({ title: 'Blue kitchen' }), used)).toBe('Blue-kitchen');
    expect(exportStem(pin({ title: 'Blue kitchen' }), used)).toBe('Blue-kitchen-2');
    expect(exportStem(pin({ title: '', pinId: '99' }), used)).toBe('pin-99');
  });

  it('turns a folder name into a safe directory', () => {
    expect(directoryName('Mood: board / 2', 'Folder')).toBe('Mood-board-2');
    expect(directoryName('???', 'Folder')).toBe('Folder');
  });

  it('writes sources a spreadsheet opens safely', () => {
    const csv = creditsCsv([
      { file: 'a.jpg', title: 'Say "hi", world', pinUrl: 'https://www.pinterest.com/pin/1/' },
      { file: 'b.jpg', title: '=HYPERLINK("x")', pinUrl: '' },
    ]);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('file,title,pin');
    expect(lines[1]).toBe('a.jpg,"Say ""hi"", world",https://www.pinterest.com/pin/1/');
    expect(lines[2]).toBe(`b.jpg,"'=HYPERLINK(""x"")",`);
  });
});
