export const GRID_SET_WIDTH_EVENT = 'pinterest-plus-plus:grid:set-width';
export const GRID_STATUS_EVENT = 'pinterest-plus-plus:grid:status';
export const GRID_DESTROY_EVENT = 'pinterest-plus-plus:grid:destroy';

export interface GridSetWidthDetail {
  requestId: number;
  width: number;
}

export type GridBridgeState = 'applying' | 'applied' | 'unsupported';

/** The live Masonry geometry, reported so the slider can bound itself to it. */
export interface GridMetrics {
  availableWidth: number;
  gutter: number;
  columns: number;
}

export interface GridStatusDetail {
  requestId: number;
  state: GridBridgeState;
  requestedWidth: number;
  effectiveWidth?: number;
  metrics?: GridMetrics;
}

export function isGridSetWidthDetail(value: unknown): value is GridSetWidthDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<GridSetWidthDetail>;
  return Number.isSafeInteger(detail.requestId) && detail.requestId! >= 0 &&
    typeof detail.width === 'number' && Number.isFinite(detail.width);
}

function isGridMetrics(value: unknown): value is GridMetrics {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<GridMetrics>;
  return typeof metrics.availableWidth === 'number' && Number.isFinite(metrics.availableWidth) &&
    typeof metrics.gutter === 'number' && Number.isFinite(metrics.gutter) &&
    typeof metrics.columns === 'number' && Number.isFinite(metrics.columns) && metrics.columns >= 1;
}

export function isGridStatusDetail(value: unknown): value is GridStatusDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<GridStatusDetail>;
  return Number.isSafeInteger(detail.requestId) && detail.requestId! >= 0 &&
    typeof detail.requestedWidth === 'number' && Number.isFinite(detail.requestedWidth) &&
    (detail.state === 'applying' || detail.state === 'applied' || detail.state === 'unsupported') &&
    (detail.effectiveWidth === undefined ||
      (typeof detail.effectiveWidth === 'number' && Number.isFinite(detail.effectiveWidth))) &&
    (detail.metrics === undefined || isGridMetrics(detail.metrics));
}
