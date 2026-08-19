import { describe, expect, it, vi } from 'vitest';
import { GridWidthController } from '../shared/grid-width-controller';
import { DEFAULT_TILE_WIDTH, MIN_TILE_WIDTH } from '../shared/settings';

describe('GridWidthController', () => {
  it('previews during dragging without reflowing and commits only changed widths', () => {
    const applyWidth = vi.fn();
    const controller = new GridWidthController(DEFAULT_TILE_WIDTH, applyWidth, 440);

    expect(controller.preview(419)).toBe(420);
    expect(controller.preview(900)).toBe(440);
    expect(applyWidth).not.toHaveBeenCalled();

    expect(controller.commit(419)).toBe(420);
    expect(applyWidth).toHaveBeenCalledOnce();
    expect(applyWidth).toHaveBeenLastCalledWith(420);

    controller.commit(420);
    expect(applyWidth).toHaveBeenCalledOnce();
  });

  it('keeps the preferred width when a narrower grid lowers the maximum', () => {
    const applyWidth = vi.fn();
    const controller = new GridWidthController(DEFAULT_TILE_WIDTH, applyWidth, 940);
    controller.commit(900);
    applyWidth.mockClear();

    expect(controller.setMax(440)).toBe(440);
    expect(applyWidth).toHaveBeenLastCalledWith(440);
    expect(controller.preferred).toBe(900);
    expect(controller.effective).toBe(440);
    expect(controller.max).toBe(440);

    expect(controller.setMax(940)).toBe(900);
    expect(applyWidth).toHaveBeenLastCalledWith(900);
    expect(controller.effective).toBe(900);
  });

  it('does not re-apply when the maximum changes without moving the effective width', () => {
    const applyWidth = vi.fn();
    const controller = new GridWidthController(240, applyWidth, 940);

    expect(controller.setMax(600)).toBe(240);
    expect(applyWidth).not.toHaveBeenCalled();
  });

  it('clamps a stored width that is below the supported minimum', () => {
    const controller = new GridWidthController(40, vi.fn(), 440);
    expect(controller.preferred).toBe(MIN_TILE_WIDTH);
    expect(controller.effective).toBe(MIN_TILE_WIDTH);
  });
});
