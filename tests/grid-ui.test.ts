import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridResizer } from '../shared/grid-resizer';
import { GridUi } from '../shared/grid-ui';
import { ICONS } from '../shared/ui-assets';

function buildPin(): HTMLElement {
  document.body.innerHTML = `
    <div data-test-id="pinWrapper" id="pin">
      <img alt="Stoneware bottle" src="https://i.pinimg.com/236x/aa/bb/cc/bottle.jpg" />
    </div>
  `;
  return document.querySelector<HTMLElement>('#pin')!;
}

describe('GridUi actions', () => {
  let ui: GridUi | null = null;
  let host: HTMLElement;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage = vi.fn(async () => ({ ok: true, message: 'Download started' }));
    (globalThis as Record<string, unknown>).browser = { runtime: { sendMessage } };
    host = document.createElement('div');
    document.documentElement.append(host);
    const grid = { applyWidth: vi.fn(), getRoots: () => [] } as unknown as GridResizer;
    ui = new GridUi(host.attachShadow({ mode: 'open' }), grid, 236);
  });

  afterEach(() => {
    ui?.destroy();
    ui = null;
    host.remove();
    delete (globalThis as Record<string, unknown>).browser;
    vi.useRealTimers();
  });

  it('returns a button to its icon after a second click during the confirmation', async () => {
    const pin = buildPin();
    const target = document.createElement('button');
    target.innerHTML = `${ICONS.download}<span>Download media</span>`;
    const idle = target.innerHTML;

    await ui!.performPinAction('download', pin, target);
    expect(target.innerHTML).toContain('Saved');
    // Clicked again while the checkmark is still showing.
    await ui!.performPinAction('download', pin, target);
    await vi.advanceTimersByTimeAsync(1500);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(target.innerHTML).toBe(idle);
  });

  it('copies through the extension when the page cannot write the clipboard', async () => {
    const pin = buildPin();
    const write = vi.fn(async () => { throw new Error('Document is not focused.'); });
    vi.stubGlobal('ClipboardItem', class { constructor(public items: unknown) {} });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write } });
    sendMessage.mockResolvedValue({ ok: true, message: 'Image copied' });
    const target = document.createElement('button');

    try {
      await ui!.performPinAction('copy', pin, target);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(write).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'COPY_MEDIA', kind: 'image' }));
    expect(target.innerHTML).toContain('Copied');
  });
});
