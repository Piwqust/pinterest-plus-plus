import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SCANNED_PINS,
  containsPin,
  findPinGridRoots,
  findPinGridRootsFrom,
  samplePins,
} from '../shared/pin-grid-roots';

function pinMarkup(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    `<article><div data-test-id="pinWrapper" id="pin-${index}"></div></article>`).join('');
}

function mockWidths(widths: Record<string, number>, fallback = 100): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = widths[this.id] ?? fallback;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) };
  });
}

describe('pin grid roots', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recognises nodes that hold a pin', () => {
    document.body.innerHTML = '<div id="holder"><div data-test-id="pinWrapper"></div></div><p id="empty"></p>';
    expect(containsPin(document.querySelector('#holder')!)).toBe(true);
    expect(containsPin(document.querySelector('[data-test-id="pinWrapper"]')!)).toBe(true);
    expect(containsPin(document.querySelector('#empty')!)).toBe(false);
    expect(containsPin(document.createTextNode('pin'))).toBe(false);
  });

  it('samples the head and tail of very deep feeds', () => {
    document.body.innerHTML = `<main id="grid">${pinMarkup(MAX_SCANNED_PINS + 40)}</main>`;
    const sampled = samplePins(document);
    expect(sampled).toHaveLength(MAX_SCANNED_PINS);
    expect(sampled[0]!.id).toBe('pin-0');
    expect(sampled.at(-1)!.id).toBe(`pin-${MAX_SCANNED_PINS + 39}`);
  });

  it('returns the outermost wide grid and ignores narrow or sparse containers', () => {
    document.body.innerHTML = `
      <main id="grid">${pinMarkup(6)}</main>
      <aside id="rail">${pinMarkup(6)}</aside>
      <section id="sparse"><div data-test-id="pinWrapper" id="lonely"></div></section>
    `;
    mockWidths({ grid: 900, rail: 200, sparse: 900 });

    expect(findPinGridRoots(document, 1_200)).toEqual([document.querySelector('#grid')]);
  });

  it('drops nested candidates and honours a caller rejection filter', () => {
    document.body.innerHTML = `<main id="outer"><div id="inner">${pinMarkup(6)}</div></main>`;
    mockWidths({ outer: 900, inner: 900 });
    const pins = samplePins(document);

    // The inner container is the nearest qualifying ancestor, so it wins.
    expect(findPinGridRootsFrom(pins, 1_200, document)).toEqual([document.querySelector('#inner')]);
    expect(findPinGridRootsFrom(pins, 1_200, document, (ancestor) => ancestor.id !== 'inner')).toEqual([]);
  });
});
