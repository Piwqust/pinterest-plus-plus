import type { ActionResponse, CopyMediaMessage, DownloadMediaMessage } from './messages';
import { withTimeout } from './async';
import { isActionResponse } from './messages';
import { collectMediaOptions, collectPinMedia, type PinMediaOption } from './media';
import type { GridResizer } from './grid-resizer';
import { GridWidthController } from './grid-width-controller';
import type { GridMetrics, GridStatusDetail } from './grid-bridge-events';
import { findPinCloseup } from './pin-closeup';
import {
  DEFAULT_GUTTER,
  DEFAULT_TILE_WIDTH,
  MIN_TILE_WIDTH,
  TILE_STEP,
  columnsForWidth,
  maxTileWidthFor,
  widthForColumns,
  writeTileWidth,
} from './settings';
import { beginDirectCopy } from './direct-copy';
import { button, type MediaAction } from './media-action-host';
import { ICONS } from './ui-assets';

const VIEWPORT_RESIZE_DEBOUNCE = 150;
const SETTINGS_WRITE_DEBOUNCE = 400;
/** Reserved for the panel and the page's own gutters when the grid is unmeasurable. */
export const VIEWPORT_WIDTH_RESERVE = 32;

export class GridUi {
  private widthController: GridWidthController;
  private range: HTMLInputElement;
  private gridValue: HTMLElement;
  private gridPanel: HTMLElement;
  private gridStatus: HTMLElement;
  private stepSmaller: HTMLButtonElement;
  private stepLarger: HTMLButtonElement;
  private toast: HTMLElement;
  private picker: HTMLElement;
  private pickerOrigin: HTMLButtonElement | undefined;
  private toastTimer: number | undefined;
  private resizeTimer: number | undefined;
  private persistTimer: number | undefined;
  private metrics: GridMetrics | null = null;
  private unsupportedNotified = false;

  constructor(private shadow: ShadowRoot, private grid: GridResizer, tileWidth: number) {
    const initialMax = maxTileWidthFor(window.innerWidth - VIEWPORT_WIDTH_RESERVE);
    this.widthController = new GridWidthController(
      tileWidth,
      (width) => this.grid.applyWidth(width),
      initialMax,
    );
    const layer = document.createElement('div');
    layer.className = 'ppp-layer';
    const gridShell = document.createElement('div');
    gridShell.className = 'ppp-grid-shell';
    gridShell.innerHTML = `
      <section class="ppp-grid-panel" id="ppp-grid-panel" aria-label="Grid tile size">
        <label class="ppp-range-row">
          <input class="ppp-range" type="range" min="${MIN_TILE_WIDTH}" max="${initialMax}" step="${TILE_STEP}" value="${this.widthController.effective}" aria-label="Tile width" />
        </label>
        <div class="ppp-grid-foot">
          <button class="ppp-step" type="button" data-step="smaller" aria-label="More columns" title="More columns">${ICONS.smaller}<span>More columns</span></button>
          <span class="ppp-grid-value"></span>
          <button class="ppp-step" type="button" data-step="larger" aria-label="Fewer columns" title="Fewer columns">${ICONS.larger}<span>Fewer columns</span></button>
          <button class="ppp-reset" type="button" aria-label="Reset tile size" title="Reset to Pinterest default">${ICONS.reset}<span>Reset</span></button>
        </div>
        <div class="ppp-grid-status" role="status" aria-live="polite"></div>
      </section>
    `;
    this.gridPanel = gridShell.querySelector<HTMLElement>('.ppp-grid-panel')!;
    this.range = gridShell.querySelector<HTMLInputElement>('.ppp-range')!;
    this.gridValue = gridShell.querySelector<HTMLElement>('.ppp-grid-value')!;
    this.gridStatus = gridShell.querySelector<HTMLElement>('.ppp-grid-status')!;
    this.stepSmaller = gridShell.querySelector<HTMLButtonElement>('[data-step="smaller"]')!;
    this.stepLarger = gridShell.querySelector<HTMLButtonElement>('[data-step="larger"]')!;
    this.previewTileWidth(this.widthController.effective);
    this.toast = document.createElement('div');
    this.toast.className = 'ppp-toast';
    this.toast.setAttribute('role', 'status');
    this.toast.setAttribute('aria-live', 'polite');
    this.picker = document.createElement('section');
    this.picker.className = 'ppp-media-picker';
    this.picker.hidden = true;
    this.picker.setAttribute('role', 'dialog');
    this.picker.setAttribute('aria-modal', 'false');
    layer.append(gridShell, this.toast, this.picker);
    this.shadow.append(layer);

    gridShell.querySelector<HTMLButtonElement>('.ppp-reset')!.addEventListener('click', () => {
      this.setTileWidth(DEFAULT_TILE_WIDTH);
      this.persistTileWidth(DEFAULT_TILE_WIDTH);
      this.showToast('Tile size reset');
    });
    this.range.addEventListener('input', () => this.previewTileWidth(Number(this.range.value)));
    this.range.addEventListener('change', () => this.commitTileWidth(Number(this.range.value)));
    this.stepSmaller.addEventListener('click', () => this.stepColumns(1));
    this.stepLarger.addEventListener('click', () => this.stepColumns(-1));
    document.addEventListener('pointerdown', this.dismissPickerOnOutsidePointerDown, true);
    document.addEventListener('keydown', this.dismissPickerOnEscape, true);
    window.addEventListener('resize', this.onViewportResize);
  }

  setTileWidth(value: number): void {
    const normalized = this.widthController.commit(value);
    this.previewTileWidth(normalized);
  }

  setGridStatus(detail: GridStatusDetail): void {
    this.gridPanel.setAttribute('aria-busy', String(detail.state === 'applying'));
    if (detail.metrics) this.applyMetrics(detail.metrics);
    if (detail.state === 'unsupported') {
      const message = 'Grid resizing is unavailable on this Pinterest version. Using the default layout.';
      this.range.disabled = true;
      this.stepSmaller.disabled = true;
      this.stepLarger.disabled = true;
      this.gridStatus.textContent = message;
      this.gridStatus.dataset.visible = 'true';
      if (!this.unsupportedNotified) {
        this.unsupportedNotified = true;
        this.showToast(message, true);
      }
      return;
    }
    // Pinterest can remount a compatible grid after a failure; a successful
    // apply is the signal that the control is usable again.
    if (detail.state === 'applied' && (this.range.disabled || this.unsupportedNotified)) {
      this.range.disabled = false;
      this.unsupportedNotified = false;
      this.gridStatus.textContent = '';
      delete this.gridStatus.dataset.visible;
      this.previewTileWidth(this.widthController.effective);
    }
  }

  private commitTileWidth(value: number): void {
    const committed = this.widthController.commit(value);
    this.previewTileWidth(committed);
    this.persistTileWidth(committed);
  }

  /**
   * Holding an arrow key fires one change event per step. Coalescing the writes
   * keeps a long keyboard adjustment inside Chrome's sync write quota.
   */
  private persistTileWidth(width: number): void {
    if (this.persistTimer !== undefined) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = undefined;
      void writeTileWidth(width).catch(() => {
        this.showToast('Could not save the tile size to your Chrome profile', true);
      });
    }, SETTINGS_WRITE_DEBOUNCE);
  }

  private stepColumns(delta: number): void {
    const available = this.availableWidth();
    const gutter = this.gutter();
    const columns = columnsForWidth(this.widthController.effective, available, gutter);
    this.commitTileWidth(widthForColumns(Math.max(1, columns + delta), available, gutter));
  }

  private availableWidth(): number {
    if (this.metrics) return this.metrics.availableWidth;
    const root = this.grid.getRoots()[0];
    const measured = root ? root.getBoundingClientRect().width : 0;
    return measured > 0 ? Math.floor(measured) : Math.max(320, window.innerWidth - VIEWPORT_WIDTH_RESERVE);
  }

  private gutter(): number {
    return this.metrics?.gutter ?? DEFAULT_GUTTER;
  }

  private applyMetrics(metrics: GridMetrics): void {
    const rebounded = !this.metrics ||
      this.metrics.availableWidth !== metrics.availableWidth ||
      this.metrics.gutter !== metrics.gutter;
    this.metrics = metrics;
    if (rebounded) this.refreshBounds();
  }

  private refreshBounds(): void {
    const max = maxTileWidthFor(this.availableWidth(), this.gutter());
    this.range.max = String(max);
    this.previewTileWidth(this.widthController.setMax(max));
  }

  /**
   * The grid can change width without any DOM mutation the bridge reports, so
   * the panel re-measures the live grid itself after a viewport change.
   */
  private onViewportResize = (): void => {
    if (this.resizeTimer !== undefined) return;
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = undefined;
      const root = this.grid.getRoots()[0];
      const measured = root ? Math.floor(root.getBoundingClientRect().width) : 0;
      const availableWidth = measured > 0
        ? measured
        : Math.max(320, window.innerWidth - VIEWPORT_WIDTH_RESERVE);
      if (this.metrics?.availableWidth === availableWidth) return;
      if (this.metrics) this.metrics = { ...this.metrics, availableWidth };
      this.refreshBounds();
    }, VIEWPORT_RESIZE_DEBOUNCE);
  };

  private previewTileWidth(value: number): void {
    const normalized = this.widthController.preview(value);
    const columns = columnsForWidth(normalized, this.availableWidth(), this.gutter());
    this.range.value = String(normalized);
    this.gridValue.textContent = `${normalized}px · ${columns} ${columns === 1 ? 'col' : 'cols'}`;
    this.range.setAttribute(
      'aria-valuetext',
      `${normalized} pixels, ${columns} ${columns === 1 ? 'column' : 'columns'}`,
    );
    if (this.range.disabled) return;
    this.stepLarger.disabled = normalized >= this.widthController.max;
    this.stepSmaller.disabled = normalized <= MIN_TILE_WIDTH;
  }

  destroy(): void {
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer);
    if (this.resizeTimer !== undefined) window.clearTimeout(this.resizeTimer);
    if (this.persistTimer !== undefined) window.clearTimeout(this.persistTimer);
    document.removeEventListener('pointerdown', this.dismissPickerOnOutsidePointerDown, true);
    document.removeEventListener('keydown', this.dismissPickerOnEscape, true);
    window.removeEventListener('resize', this.onViewportResize);
    this.closePicker(false);
  }

  async performPinAction(action: MediaAction, pin: HTMLElement, target: HTMLButtonElement): Promise<void> {
    await this.performMediaAction(action, collectPinMedia(pin), target);
  }

  /**
   * Resolves the close-up's media at click time rather than at decoration time,
   * so a carousel that has advanced, or a pin Pinterest has swapped in without
   * remounting the card, still acts on what is actually on screen.
   */
  async performCloseupAction(action: MediaAction, target: HTMLButtonElement): Promise<void> {
    const closeup = findPinCloseup(document);
    await this.performMediaAction(action, closeup ? collectMediaOptions(closeup.media) : [], target);
  }

  private async performMediaAction(
    action: MediaAction,
    options: PinMediaOption[],
    target: HTMLButtonElement,
  ): Promise<void> {
    if (options.length === 0) {
      this.showToast('No Pinterest media is available for this pin', true);
      return;
    }
    if (options.length === 1) {
      await this.performAction(action, options[0]!, target);
      return;
    }
    this.openPicker(action, options, target);
  }

  private async performAction(
    action: MediaAction,
    media: PinMediaOption,
    target: HTMLButtonElement,
  ): Promise<boolean> {
    if (action === 'download' && media.candidates.length === 0) {
      this.showToast(
        media.kind === 'video'
          ? 'Pinterest has not exposed a downloadable video file for this slide'
          : 'Pinterest has not exposed a downloadable media file for this item',
        true,
      );
      return false;
    }
    const originalMarkup = target.innerHTML;
    target.disabled = true;
    target.setAttribute('aria-busy', 'true');
    const message: CopyMediaMessage | DownloadMediaMessage = action === 'copy'
      ? {
          type: 'COPY_MEDIA',
          kind: media.kind,
          candidates: media.candidates,
          posterCandidates: media.posterCandidates,
        }
      : {
          type: 'DOWNLOAD_MEDIA',
          kind: media.kind,
          candidates: media.candidates,
          suggestedName: media.suggestedName,
        };

    try {
      // `navigator.clipboard.write` must begin in the same task as the button
      // click. Sending Copy through the service worker first loses Chrome's
      // transient user activation and leaves some builds waiting indefinitely.
      const directCopy = action === 'copy' ? beginDirectCopy(media) : null;
      const response: unknown = await (directCopy ?? withTimeout(
        browser.runtime.sendMessage(message),
        25_000,
        action === 'copy' ? 'Copy timed out. Please try again.' : 'Download timed out. Please try again.',
      ));
      const result: ActionResponse = isActionResponse(response)
        ? response
        : { ok: false, message: 'The extension did not respond' };
      if (result.ok) target.innerHTML = `${ICONS.check}<span>${action === 'copy' ? 'Copied' : 'Saved'}</span>`;
      this.showToast(result.message, !result.ok);
      window.setTimeout(() => { target.innerHTML = originalMarkup; }, 1200);
      return result.ok;
    } catch (error) {
      const fallback = action === 'copy' ? 'Could not copy this media' : 'Could not start the download';
      this.showToast(error instanceof Error ? error.message : fallback, true);
      return false;
    } finally {
      target.disabled = false;
      target.removeAttribute('aria-busy');
    }
  }

  private openPicker(action: MediaAction, options: PinMediaOption[], origin: HTMLButtonElement): void {
    this.closePicker(false);
    this.pickerOrigin = origin;
    this.picker.replaceChildren();
    this.picker.setAttribute('aria-label', action === 'copy' ? 'Choose media to copy' : 'Choose media to download');
    this.picker.dataset.density = options.length > 18 ? 'compact' : options.length > 6 ? 'dense' : 'regular';

    const header = document.createElement('div');
    header.className = 'ppp-picker-header';
    const titleBlock = document.createElement('div');
    titleBlock.className = 'ppp-picker-title-block';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'ppp-picker-eyebrow';
    eyebrow.textContent = action === 'copy' ? 'Copy to clipboard' : 'Save to device';
    const title = document.createElement('span');
    title.className = 'ppp-picker-title';
    title.textContent = 'Choose media';
    const subtitle = document.createElement('span');
    subtitle.className = 'ppp-picker-subtitle';
    subtitle.textContent = `${options.length} ${options.length === 1 ? 'item' : 'items'} available`;
    titleBlock.append(eyebrow, title, subtitle);
    const closeButton = button('ppp-picker-close', 'Close media picker', ICONS.close);
    closeButton.addEventListener('click', () => this.closePicker());
    header.append(titleBlock, closeButton);

    const grid = document.createElement('div');
    grid.className = 'ppp-picker-grid';
    const scrollArea = document.createElement('div');
    scrollArea.className = 'ppp-picker-scroll';
    let imageIndex = 0;
    let videoIndex = 0;
    for (const option of options) {
      const index = option.kind === 'image' ? ++imageIndex : ++videoIndex;
      const label = `${option.kind === 'image' ? 'Image' : 'Video'} ${index}`;
      const optionButton = document.createElement('button');
      optionButton.className = 'ppp-media-option';
      optionButton.type = 'button';
      const actionLabel = action === 'copy' && option.kind === 'video' ? 'Copy first frame from' : `${action === 'copy' ? 'Copy' : 'Download'}`;
      optionButton.setAttribute('aria-label', `${actionLabel} ${label}`);

      const previewWrap = document.createElement('span');
      previewWrap.className = 'ppp-media-preview-wrap';
      if (option.previewUrl) {
        const preview = document.createElement('img');
        preview.className = 'ppp-media-preview';
        preview.src = option.previewUrl;
        preview.alt = '';
        previewWrap.append(preview);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'ppp-media-preview-fallback';
        fallback.textContent = option.kind === 'video' ? 'Video' : 'Image';
        previewWrap.append(fallback);
      }
      if (option.kind === 'video') {
        const kind = document.createElement('span');
        kind.className = 'ppp-media-kind';
        kind.textContent = 'Video';
        previewWrap.append(kind);
      }
      const caption = document.createElement('span');
      caption.className = 'ppp-media-label';
      caption.textContent = label;
      optionButton.append(previewWrap, caption);
      optionButton.addEventListener('click', () => void this.selectPickerOption(action, option, origin));
      grid.append(optionButton);
    }

    scrollArea.append(grid);
    this.picker.append(header, scrollArea);
    this.picker.hidden = false;
    this.positionPicker(origin);
    window.requestAnimationFrame(() => grid.querySelector<HTMLButtonElement>('.ppp-media-option')?.focus());
  }

  private async selectPickerOption(action: MediaAction, option: PinMediaOption, origin: HTMLButtonElement): Promise<void> {
    if (this.picker.hidden || this.pickerOrigin !== origin) return;
    const pickerButtons = Array.from(this.picker.querySelectorAll<HTMLButtonElement>('.ppp-media-option'));
    for (const buttonElement of pickerButtons) buttonElement.disabled = true;
    this.picker.setAttribute('aria-busy', 'true');

    const completed = await this.performAction(action, option, origin);
    if (completed) {
      this.closePicker();
      return;
    }

    this.picker.removeAttribute('aria-busy');
    for (const buttonElement of pickerButtons) buttonElement.disabled = false;
  }

  private positionPicker(origin: HTMLButtonElement): void {
    const anchor = origin.getBoundingClientRect();
    const pickerBounds = this.picker.getBoundingClientRect();
    const gap = 8;
    const viewportPadding = 12;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - pickerBounds.width - viewportPadding);
    const left = Math.min(Math.max(viewportPadding, anchor.right - pickerBounds.width), maxLeft);
    const preferredTop = anchor.bottom + gap + pickerBounds.height <= window.innerHeight - viewportPadding
      ? anchor.bottom + gap
      : anchor.top - pickerBounds.height - gap;
    const maxTop = Math.max(viewportPadding, window.innerHeight - pickerBounds.height - viewportPadding);
    const top = Math.min(Math.max(viewportPadding, preferredTop), maxTop);
    this.picker.style.left = `${Math.round(left)}px`;
    this.picker.style.top = `${Math.round(top)}px`;
  }

  private closePicker(restoreFocus = true): void {
    if (this.picker.hidden) return;
    const origin = this.pickerOrigin;
    this.picker.hidden = true;
    this.picker.removeAttribute('aria-busy');
    this.picker.replaceChildren();
    delete this.picker.dataset.density;
    this.pickerOrigin = undefined;
    if (restoreFocus && origin?.isConnected) origin.focus();
  }

  private dismissPickerOnOutsidePointerDown = (event: PointerEvent): void => {
    if (this.picker.hidden || event.composedPath().includes(this.picker)) return;
    this.closePicker();
  };

  private dismissPickerOnEscape = (event: KeyboardEvent): void => {
    if (this.picker.hidden || event.key !== 'Escape') return;
    event.preventDefault();
    this.closePicker();
  };

  private showToast(message: string, error = false): void {
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.dataset.error = String(error);
    this.toast.dataset.visible = 'true';
    this.toastTimer = window.setTimeout(() => { this.toast.dataset.visible = 'false'; }, 2200);
  }
}
