import { ABSOLUTE_MAX_TILE_WIDTH, clampTileWidth } from './settings';

/**
 * Keeps the width the user chose separate from the width the current grid can
 * actually show. Shrinking the window narrows the effective width without
 * discarding the preference, so widening it again restores the original choice.
 */
export class GridWidthController {
  private preferredWidth: number;
  private effectiveWidth: number;
  private maxWidth: number;

  constructor(
    initialWidth: number,
    private applyWidth: (width: number) => void,
    maxWidth: number = ABSOLUTE_MAX_TILE_WIDTH,
  ) {
    this.maxWidth = clampTileWidth(maxWidth);
    this.preferredWidth = clampTileWidth(initialWidth);
    this.effectiveWidth = clampTileWidth(this.preferredWidth, this.maxWidth);
  }

  get preferred(): number {
    return this.preferredWidth;
  }

  get effective(): number {
    return this.effectiveWidth;
  }

  get max(): number {
    return this.maxWidth;
  }

  preview(value: number): number {
    return clampTileWidth(value, this.maxWidth);
  }

  commit(value: number): number {
    const normalized = this.preview(value);
    this.preferredWidth = normalized;
    if (normalized === this.effectiveWidth) return normalized;
    this.effectiveWidth = normalized;
    this.applyWidth(normalized);
    return normalized;
  }

  setMax(max: number): number {
    this.maxWidth = clampTileWidth(max);
    const next = clampTileWidth(this.preferredWidth, this.maxWidth);
    if (next === this.effectiveWidth) return this.effectiveWidth;
    this.effectiveWidth = next;
    this.applyWidth(next);
    return next;
  }
}
