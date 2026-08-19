import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_CLOSEUP_MEDIA_EDGE, findPinCloseup } from '../shared/pin-closeup';

/** Sizes elements by id; anything unnamed stays too small to be the close-up. */
function mockSizes(sizes: Record<string, [number, number]>): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const [width, height] = sizes[this.id] ?? [24, 24];
    return {
      x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
    };
  });
}

const HERO_SIZE: [number, number] = [600, 420];
/** The card's own geometry: an icon, the bar laying the icons out, and the card. */
const CARD_SIZES: Record<string, [number, number]> = {
  'closeup-more': [40, 40],
  'ellipsis-frame': [40, 40],
  'ellipsis-item': [40, 40],
  'action-bar': [420, 48],
  'details-column': [420, 700],
  'closeup-card': [1040, 700],
};

function withCardSizes(sizes: Record<string, [number, number]>): Record<string, [number, number]> {
  return { ...CARD_SIZES, ...sizes };
}

/**
 * The close-up card: a media column beside a details column holding the action
 * bar, with Pinterest's own wrappers between the card and each of them.
 */
function closeupMarkup(mediaColumn: string): string {
  return `
    <div id="closeup-card">
      <div id="media-column"><div><div>${mediaColumn}</div></div></div>
      <div id="details-column">
        <img id="avatar" src="https://i.pinimg.com/75x75_RS/author.jpg">
        <div id="action-bar">
          <button aria-label="React" id="react"></button>
          <div id="ellipsis-item">
            <div id="ellipsis-frame"><button aria-label="More options" id="closeup-more"></button></div>
          </div>
          <button id="see-more">See more</button>
          <button aria-label="Save" id="save"></button>
        </div>
      </div>
    </div>
  `;
}

function relatedGridMarkup(): string {
  return `
    <div id="related">
      <div data-test-id="pinWrapper" id="related-a">
        <img id="related-image-a" src="https://i.pinimg.com/236x/a.jpg">
        <button aria-label="More options" id="related-more-a"></button>
      </div>
      <div data-test-id="pinWrapper" id="related-b">
        <img id="related-image-b" src="https://i.pinimg.com/236x/b.jpg">
        <button aria-label="More options" id="related-more-b"></button>
      </div>
    </div>
  `;
}

describe('pin close-up', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/pin/1084152461363/');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('anchors to the close-up three-dot menu and scopes media to the hero', () => {
    document.body.innerHTML = closeupMarkup(
      '<div id="media-frame"><img id="hero" src="https://i.pinimg.com/originals/hero.jpg"></div>',
    ) + relatedGridMarkup();
    mockSizes(withCardSizes({ hero: HERO_SIZE }));

    const closeup = findPinCloseup(document)!;
    expect(closeup.anchor.id).toBe('ellipsis-item');
    expect(closeup.media.map((element) => element.id)).toEqual(['hero']);
  });

  it('reaches an action bar Pinterest renders far above the media', () => {
    const wrappers = 16;
    document.body.innerHTML = closeupMarkup(
      '<div>'.repeat(wrappers) +
      '<img id="hero" src="https://i.pinimg.com/originals/hero.jpg">' +
      '</div>'.repeat(wrappers),
    );
    mockSizes(withCardSizes({ hero: HERO_SIZE }));

    expect(findPinCloseup(document)?.anchor.id).toBe('ellipsis-item');
  });

  it('anchors to the menu itself when the action bar lays it out directly', () => {
    document.body.innerHTML = `
      <div id="closeup-card">
        <div id="media-column"><img id="hero" src="https://i.pinimg.com/originals/hero.jpg"></div>
        <div id="action-bar"><button aria-label="More options" id="closeup-more"></button></div>
      </div>
    `;
    mockSizes(withCardSizes({ hero: HERO_SIZE }));

    expect(findPinCloseup(document)?.anchor.id).toBe('closeup-more');
  });

  it('finds a close-up whose media is a video', () => {
    document.body.innerHTML = closeupMarkup(
      '<div id="media-frame"><video id="hero" src="https://v1.pinimg.com/videos/mc/720p/aa/bb/cc/deadbeefdeadbeefdeadbeefdeadbeef.mp4"></video></div>',
    );
    mockSizes(withCardSizes({ hero: HERO_SIZE }));

    expect(findPinCloseup(document)?.media.map((element) => element.tagName)).toEqual(['VIDEO']);
  });

  it('keeps every carousel slide but leaves the card\'s own imagery out', () => {
    document.body.innerHTML = closeupMarkup(`
      <div id="media-frame">
        <img id="slide-1" src="https://i.pinimg.com/originals/one.jpg">
        <img id="slide-2" src="https://i.pinimg.com/originals/two.jpg">
      </div>
    `);
    mockSizes(withCardSizes({ 'slide-1': HERO_SIZE, 'slide-2': HERO_SIZE }));

    const closeup = findPinCloseup(document)!;
    expect(closeup.media.map((element) => element.id)).toEqual(['slide-1', 'slide-2']);
  });

  it('leaves the related grid out of the media even when it shares the card\'s branch', () => {
    document.body.innerHTML = `
      <div id="feed">
        ${closeupMarkup('<div id="media-frame"><img id="hero" src="https://i.pinimg.com/originals/hero.jpg"></div>')}
        ${relatedGridMarkup()}
      </div>
    `;
    mockSizes(withCardSizes({ hero: HERO_SIZE, 'related-image-a': [900, 900] }));

    const closeup = findPinCloseup(document)!;
    expect(closeup.anchor.id).toBe('ellipsis-item');
    expect(closeup.media.map((element) => element.id)).toEqual(['hero']);
  });

  it('ignores media that is too small to be the pin being viewed', () => {
    document.body.innerHTML = closeupMarkup(
      '<div id="media-frame"><img id="hero" src="https://i.pinimg.com/originals/hero.jpg"></div>',
    );
    mockSizes(withCardSizes({ hero: [MIN_CLOSEUP_MEDIA_EDGE + 40, MIN_CLOSEUP_MEDIA_EDGE - 1] }));

    expect(findPinCloseup(document)).toBeNull();
  });

  it('never treats a grid tile as the close-up, however large its tiles are', () => {
    document.body.innerHTML = relatedGridMarkup();
    mockSizes({ 'related-image-a': [900, 900], 'related-image-b': [900, 900] });

    expect(findPinCloseup(document)).toBeNull();
  });

  it('stops rather than borrowing a neighbouring pin\'s menu', () => {
    // A close-up card with no menu of its own, sharing an ancestor with the feed.
    document.body.innerHTML = `
      <div id="page">
        <div id="media-frame"><img id="hero" src="https://i.pinimg.com/originals/hero.jpg"></div>
        ${relatedGridMarkup()}
      </div>
    `;
    mockSizes({ hero: HERO_SIZE });

    expect(findPinCloseup(document)).toBeNull();
  });

  it('does not mistake the description\'s See more control for the overflow menu', () => {
    document.body.innerHTML = `
      <div id="closeup-card">
        <div id="media-frame"><img id="hero" src="https://i.pinimg.com/originals/hero.jpg"></div>
        <button id="see-more">See more</button>
      </div>
    `;
    mockSizes({ hero: HERO_SIZE });

    expect(findPinCloseup(document)).toBeNull();
  });

  it('reports no close-up on a plain feed', () => {
    document.body.innerHTML = relatedGridMarkup();
    mockSizes({});

    expect(findPinCloseup(document)).toBeNull();
  });

  it('reports no close-up away from a pin permalink', () => {
    window.history.pushState({}, '', '/search/pins/?q=dashboard');
    document.body.innerHTML = closeupMarkup(
      '<div id="media-frame"><img id="hero" src="https://i.pinimg.com/originals/hero.jpg"></div>',
    );
    mockSizes(withCardSizes({ hero: HERO_SIZE }));

    expect(findPinCloseup(document)).toBeNull();
  });
});
