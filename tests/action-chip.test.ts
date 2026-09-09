import { beforeEach, describe, expect, it } from 'vitest';
import { chipFor, DEFAULT_CHIP, isOverMedia, readChipStyle } from '../shared/action-chip';

/** jsdom measures nothing, so every rect a test cares about is stated here. */
function stubRect(element: Element, rect: { x: number; y: number; width: number; height: number }): void {
  element.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  }) as DOMRect;
}

function build(markup: string): HTMLElement {
  document.body.innerHTML = `<div id="pin">${markup}</div>`;
  return document.querySelector<HTMLElement>('#pin')!;
}

describe('readChipStyle', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('returns nothing for a control that paints no background', () => {
    build('<button id="more"><svg></svg></button>');
    expect(readChipStyle(document.querySelector<HTMLElement>('#more')!)).toBeNull();
  });

  it('mirrors the background a wrapper inside the control paints', () => {
    build('<button id="more"><span id="chip" style="background-color: rgb(255, 255, 255)"></span></button>');
    stubRect(document.querySelector('#chip')!, { x: 0, y: 0, width: 40, height: 40 });

    expect(readChipStyle(document.querySelector<HTMLElement>('#more')!))
      .toEqual({ background: 'rgb(255, 255, 255)', radius: '50%', size: 40 });
  });

  it('ignores a background too faint to read an icon against', () => {
    build('<button id="more" style="background-color: rgba(0, 0, 0, 0.02)"></button>');
    expect(readChipStyle(document.querySelector<HTMLElement>('#more')!)).toBeNull();
  });

  it('leaves the size out when the control measures outside button proportions', () => {
    build('<button id="more" style="background-color: rgb(20, 20, 20)"></button>');
    stubRect(document.querySelector('#more')!, { x: 0, y: 0, width: 300, height: 12 });

    expect(readChipStyle(document.querySelector<HTMLElement>('#more')!)?.size).toBeUndefined();
  });
});

describe('isOverMedia', () => {
  it('reports a control whose centre lies inside the pin image', () => {
    const pin = build('<img id="media" /><button id="more"></button>');
    stubRect(document.querySelector('#media')!, { x: 0, y: 0, width: 200, height: 300 });
    stubRect(document.querySelector('#more')!, { x: 160, y: 250, width: 32, height: 32 });

    expect(isOverMedia(document.querySelector<HTMLElement>('#more')!, pin)).toBe(true);
  });

  it('reports a control laid out under the image', () => {
    const pin = build('<img id="media" /><button id="more"></button>');
    stubRect(document.querySelector('#media')!, { x: 0, y: 0, width: 200, height: 300 });
    stubRect(document.querySelector('#more')!, { x: 160, y: 320, width: 32, height: 32 });

    expect(isOverMedia(document.querySelector<HTMLElement>('#more')!, pin)).toBe(false);
  });

  it('reports nothing for a control the layout has not painted yet', () => {
    const pin = build('<img id="media" /><button id="more"></button>');
    stubRect(document.querySelector('#media')!, { x: 0, y: 0, width: 200, height: 300 });

    expect(isOverMedia(document.querySelector<HTMLElement>('#more')!, pin)).toBe(false);
  });
});

describe('chipFor', () => {
  it('always chips buttons overlaid on a pin with no control of its own', () => {
    const pin = build('<img id="media" />');
    expect(chipFor(pin, null)).toEqual(DEFAULT_CHIP);
  });

  it('copies the chip the neighbouring control paints', () => {
    const pin = build('<img id="media" /><button id="more" style="background-color: rgb(255, 255, 255)"></button>');
    stubRect(document.querySelector('#more')!, { x: 0, y: 0, width: 32, height: 32 });

    expect(chipFor(pin, document.querySelector<HTMLElement>('#more')!))
      .toEqual({ background: 'rgb(255, 255, 255)', radius: '50%', size: 32 });
  });

  it('stays bare in a footer row that paints a surface of its own', () => {
    const pin = build('<img id="media" /><div style="background-color: rgb(255, 255, 255)"><button id="more"></button></div>');
    expect(chipFor(pin, document.querySelector<HTMLElement>('#more')!)).toBeNull();
  });

  it('chips a bare control that Pinterest laid onto the image', () => {
    const pin = build('<img id="media" /><button id="more"></button>');
    stubRect(document.querySelector('#media')!, { x: 0, y: 0, width: 200, height: 300 });
    stubRect(document.querySelector('#more')!, { x: 150, y: 250, width: 32, height: 32 });

    expect(chipFor(pin, document.querySelector<HTMLElement>('#more')!)).toEqual(DEFAULT_CHIP);
  });

  it('stays bare beside a control that sits below the image', () => {
    const pin = build('<img id="media" /><button id="more"></button>');
    stubRect(document.querySelector('#media')!, { x: 0, y: 0, width: 200, height: 300 });
    stubRect(document.querySelector('#more')!, { x: 150, y: 320, width: 32, height: 32 });

    expect(chipFor(pin, document.querySelector<HTMLElement>('#more')!)).toBeNull();
  });
});

describe('hasSurfaceBelow', () => {
  it('ignores the page behind a control that sits beside the pin card', () => {
    document.body.innerHTML = `
      <article style="background-color: rgb(255, 255, 255)">
        <div id="pin"><img id="media" /></div>
        <button id="more"></button>
      </article>
    `;
    const pin = document.querySelector<HTMLElement>('#pin')!;
    stubRect(document.querySelector('#media')!, { x: 0, y: 0, width: 200, height: 300 });
    stubRect(document.querySelector('#more')!, { x: 150, y: 250, width: 32, height: 32 });

    expect(chipFor(pin, document.querySelector<HTMLElement>('#more')!)).toEqual(DEFAULT_CHIP);
  });

  it('honours a footer strip rendered beside the pin card', () => {
    document.body.innerHTML = `
      <article>
        <div id="pin"><img id="media" /></div>
        <div style="background-color: rgb(255, 255, 255)"><button id="more"></button></div>
      </article>
    `;
    const pin = document.querySelector<HTMLElement>('#pin')!;
    expect(chipFor(pin, document.querySelector<HTMLElement>('#more')!)).toBeNull();
  });
});
