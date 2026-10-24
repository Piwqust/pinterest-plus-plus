import { afterEach, describe, expect, it } from 'vitest';
import type { HueShare } from '../shared/collection';
import { PaletteQueue, capturePin, isPromotedPin } from '../shared/pin-capture';
import type { CollectionStore } from '../shared/collection-store';

function card(footer: string, media = '<img src="https://i.pinimg.com/236x/aa/bb/pin.jpg" alt="This contains an image of: Blue kitchen">'): HTMLElement {
  document.body.innerHTML = `
    <div data-grid-item="true">
      <div data-test-id="pinWrapper">
        <a href="/pin/123456/">${media}</a>
      </div>
      <div class="footer">${footer}</div>
    </div>`;
  return document.querySelector<HTMLElement>('[data-test-id="pinWrapper"]')!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('promoted pins', () => {
  it('spots the label Pinterest prints under an ad', () => {
    expect(isPromotedPin(card('<div><span>Promoted by</span><span>Acme</span></div>'))).toBe(true);
    expect(isPromotedPin(card('<div>Sponsored</div>'))).toBe(true);
  });

  it('spots a test id that names it', () => {
    expect(isPromotedPin(card('<div data-test-id="pinrep-promoted-label">x</div>'))).toBe(true);
  });

  it('leaves an ordinary pin alone, even one whose title mentions promotion', () => {
    expect(isPromotedPin(card('<div><span>Kitchen ideas</span></div>'))).toBe(false);
    expect(isPromotedPin(card('<div><span>How we promoted our bakery on a budget this spring</span></div>'))).toBe(false);
  });
});

describe('capturing a grid pin', () => {
  it('keeps the pin id, a readable title and the original first', () => {
    const captured = capturePin(card(''), 7)!;
    expect(captured.key).toBe('123456');
    expect(captured.pinId).toBe('123456');
    expect(captured.title).toBe('Blue kitchen');
    expect(captured.kind).toBe('image');
    expect(captured.candidates[0]).toBe('https://i.pinimg.com/originals/aa/bb/pin.jpg');
    expect(captured.addedAt).toBe(7);
    expect(captured.palette).toBeNull();
  });

  it('captures nothing from a tile without media', () => {
    expect(capturePin(card('', '<span>Loading</span>'))).toBeNull();
  });
});

describe('palette queue', () => {
  it('measures each unmeasured pin once and stores what it found', async () => {
    const pins = [
      { key: 'a', previewUrl: 'https://i.pinimg.com/236x/a.jpg', palette: null },
      { key: 'b', previewUrl: 'https://i.pinimg.com/236x/b.jpg', palette: [] },
      { key: 'c', previewUrl: 'https://i.pinimg.com/236x/c.jpg', palette: null },
    ];
    const stored = new Map<string, HueShare[]>();
    const store = {
      get snapshot() { return { pins, folders: [] }; },
      setPalette: (key: string, palette: HueShare[]) => stored.set(key, palette),
    } as unknown as CollectionStore;
    const measured: string[] = [];
    const queue = new PaletteQueue(store, async (url) => {
      measured.push(url);
      if (url.endsWith('c.jpg')) throw new Error('offline');
      return [{ hue: 'teal', share: 1 }];
    });

    queue.fill();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(measured.sort()).toEqual(['https://i.pinimg.com/236x/a.jpg', 'https://i.pinimg.com/236x/c.jpg']);
    expect(stored.get('a')).toEqual([{ hue: 'teal', share: 1 }]);
    expect(stored.get('c')).toEqual([]);
  });
});
