import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseupActionManager } from '../shared/closeup-action-manager';

function mockSizes(sizes: Record<string, [number, number]>): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const [width, height] = sizes[this.id] ?? [24, 24];
    return {
      x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
    };
  });
}

const CLOSEUP_MARKUP = `
  <div id="closeup-card">
    <div id="media-column"><img id="hero" src="https://i.pinimg.com/originals/hero.jpg"></div>
    <div id="details-column"><button aria-label="More options" id="closeup-more"></button></div>
  </div>
`;

/** Enough of the card's geometry for the anchor to resolve to the menu itself. */
const CLOSEUP_SIZES: Record<string, [number, number]> = {
  hero: [600, 420],
  'details-column': [420, 700],
  'closeup-card': [1040, 700],
};

const FEED_MARKUP = `
  <main id="grid">
    <div data-test-id="pinWrapper"><img src="https://i.pinimg.com/236x/a.jpg"></div>
    <div data-test-id="pinWrapper"><img src="https://i.pinimg.com/236x/b.jpg"></div>
  </main>
`;

function hostsInDocument(): number {
  return document.querySelectorAll('[data-ppp-ignore="true"]').length;
}

describe('CloseupActionManager', () => {
  let manager: CloseupActionManager | null = null;
  let created = 0;

  const createHost = (): HTMLElement => {
    created += 1;
    const host = document.createElement('span');
    host.dataset.pppIgnore = 'true';
    return host;
  };

  /** Lets the mutation observer fire and its debounced scan run. */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(500);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    created = 0;
    // Pinterest serves every close-up at the pin's permalink.
    window.history.pushState({}, '', '/pin/1084152461363/');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    manager?.stop();
    manager = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('places its host before the close-up menu as soon as it starts', () => {
    document.body.innerHTML = CLOSEUP_MARKUP;
    mockSizes(CLOSEUP_SIZES);
    manager = new CloseupActionManager(createHost);
    manager.start();

    expect(hostsInDocument()).toBe(1);
    expect(document.querySelector('#closeup-more')!.previousElementSibling)
      .toBe(document.querySelector('[data-ppp-ignore="true"]'));
  });

  it('decorates a close-up that Pinterest navigates to after start', async () => {
    document.body.innerHTML = FEED_MARKUP;
    mockSizes(CLOSEUP_SIZES);
    manager = new CloseupActionManager(createHost);
    manager.start();
    expect(hostsInDocument()).toBe(0);

    document.body.innerHTML = CLOSEUP_MARKUP;
    await settle();

    expect(hostsInDocument()).toBe(1);
    expect(created).toBe(1);
  });

  it('releases its host when the close-up is left', async () => {
    document.body.innerHTML = CLOSEUP_MARKUP;
    mockSizes(CLOSEUP_SIZES);
    manager = new CloseupActionManager(createHost);
    manager.start();
    expect(hostsInDocument()).toBe(1);

    document.body.innerHTML = FEED_MARKUP;
    await settle();

    expect(hostsInDocument()).toBe(0);
  });

  it('does not rebuild the host while the same close-up stays mounted', async () => {
    document.body.innerHTML = CLOSEUP_MARKUP;
    mockSizes(CLOSEUP_SIZES);
    manager = new CloseupActionManager(createHost);
    manager.start();

    document.querySelector('#details-column')!.append(document.createElement('span'));
    await settle();

    expect(created).toBe(1);
    expect(hostsInDocument()).toBe(1);
  });

  it('restores a host Pinterest re-ordered away from the menu', async () => {
    document.body.innerHTML = CLOSEUP_MARKUP;
    mockSizes(CLOSEUP_SIZES);
    manager = new CloseupActionManager(createHost);
    manager.start();

    const host = document.querySelector<HTMLElement>('[data-ppp-ignore="true"]')!;
    document.querySelector('#details-column')!.append(host);
    await settle();

    expect(created).toBe(1);
    expect(document.querySelector('#closeup-more')!.previousElementSibling).toBe(host);
  });

  it('removes its host when stopped', () => {
    document.body.innerHTML = CLOSEUP_MARKUP;
    mockSizes(CLOSEUP_SIZES);
    manager = new CloseupActionManager(createHost);
    manager.start();
    manager.stop();
    manager = null;

    expect(hostsInDocument()).toBe(0);
  });
});
