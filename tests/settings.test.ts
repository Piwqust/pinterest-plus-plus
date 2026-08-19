import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_MAX_TILE_WIDTH,
  DEFAULT_TILE_WIDTH,
  FALLBACK_MAX_TILE_WIDTH,
  MIN_TILE_WIDTH,
  clampTileWidth,
  columnsForWidth,
  maxTileWidthFor,
  widthForColumns,
} from '../shared/settings';

describe('grid tile sizing', () => {
  it('uses the default for invalid values', () => {
    expect(clampTileWidth('not-a-number')).toBe(DEFAULT_TILE_WIDTH);
  });

  it('clamps to the supported range', () => {
    expect(clampTileWidth(20)).toBe(MIN_TILE_WIDTH);
    expect(clampTileWidth(9_000)).toBe(ABSOLUTE_MAX_TILE_WIDTH);
  });

  it('snaps values to four-pixel increments', () => {
    expect(clampTileWidth(251)).toBe(252);
    expect(clampTileWidth(253)).toBe(252);
  });

  it('honours an explicit maximum without losing the floor', () => {
    expect(clampTileWidth(900, 440)).toBe(440);
    expect(clampTileWidth(300, 440)).toBe(300);
    expect(clampTileWidth(900, 40)).toBe(MIN_TILE_WIDTH);
  });
});

describe('viewport-relative limits', () => {
  it('offers at most half the grid so two columns always fit', () => {
    expect(maxTileWidthFor(900, 16)).toBe(440);
    expect(columnsForWidth(maxTileWidthFor(900, 16), 900, 16)).toBe(2);
    expect(maxTileWidthFor(1_920, 16)).toBe(952);
    expect(columnsForWidth(maxTileWidthFor(1_920, 16), 1_920, 16)).toBe(2);
  });

  it('never drops below the minimum tile width or above the storage ceiling', () => {
    expect(maxTileWidthFor(200, 16)).toBe(MIN_TILE_WIDTH);
    expect(maxTileWidthFor(10_000, 16)).toBe(ABSOLUTE_MAX_TILE_WIDTH);
  });

  it('falls back when the grid cannot be measured', () => {
    expect(maxTileWidthFor(Number.NaN)).toBe(FALLBACK_MAX_TILE_WIDTH);
    expect(maxTileWidthFor(0)).toBe(FALLBACK_MAX_TILE_WIDTH);
    expect(columnsForWidth(236, 0)).toBe(1);
    expect(widthForColumns(3, 0)).toBe(DEFAULT_TILE_WIDTH);
  });

  it('round-trips between column counts and tile widths', () => {
    for (const columns of [2, 3, 4, 5]) {
      const width = widthForColumns(columns, 900, 16);
      expect(columnsForWidth(width, 900, 16)).toBe(columns);
    }
  });

  it('clamps a column request that would go below the minimum tile width', () => {
    expect(widthForColumns(40, 900, 16)).toBe(MIN_TILE_WIDTH);
    expect(widthForColumns(1, 1_920, 16)).toBe(1_920);
  });
});
