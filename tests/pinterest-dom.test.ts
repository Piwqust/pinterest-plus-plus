import { beforeEach, describe, expect, it } from 'vitest';
import { findGridItem, findMoreControl } from '../shared/pinterest-dom';

describe('Pinterest action scoping', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses only the More Actions control inside the current pin item', () => {
    document.body.innerHTML = `
      <header><button aria-label="More actions" id="header-more"></button></header>
      <main id="grid">
        <article id="pin-item">
          <div data-test-id="pinWrapper"><img src="https://i.pinimg.com/originals/pin.jpg"></div>
          <button aria-label="More actions" id="pin-more"></button>
        </article>
      </main>
    `;
    const item = document.querySelector<HTMLElement>('#pin-item')!;

    expect(findMoreControl(item)?.id).toBe('pin-more');
  });

  it('does not mistake a Learn more link for the overflow menu', () => {
    document.body.innerHTML = '<article id="pin-item"><a role="button">Learn more</a></article>';

    expect(findMoreControl(document.querySelector<HTMLElement>('#pin-item')!)).toBeNull();
  });

  it('skips a menu the caller rejects and keeps looking', () => {
    document.body.innerHTML = `
      <div id="card">
        <div data-test-id="pinWrapper"><button aria-label="More actions" id="pin-more"></button></div>
        <button aria-label="More actions" id="card-more"></button>
      </div>
    `;
    const card = document.querySelector<HTMLElement>('#card')!;

    expect(findMoreControl(card, (control) => !control.closest('[data-test-id="pinWrapper"]'))?.id)
      .toBe('card-more');
  });

  it('returns the single-pin branch without swallowing neighboring pins', () => {
    document.body.innerHTML = `
      <main id="grid">
        <section id="first"><article><div><div data-test-id="pinWrapper" id="pin-a"></div></div></article></section>
        <section><article><div data-test-id="pinWrapper" id="pin-b"></div></article></section>
      </main>
    `;
    const root = document.querySelector<HTMLElement>('#grid')!;
    const pin = document.querySelector<HTMLElement>('#pin-a')!;

    expect(findGridItem(pin, root).id).toBe('first');
  });

});
