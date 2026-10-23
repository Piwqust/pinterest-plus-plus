import { describe, expect, it } from 'vitest';
import { createMediaActionHost, setActionsVisible } from '../shared/media-action-host';

function actionsOf(host: HTMLElement): HTMLElement {
  return host.shadowRoot!.querySelector<HTMLElement>('.ppp-pin-actions')!;
}

describe('createMediaActionHost', () => {
  it('starts a grid tile pair hidden and a close-up pair shown', () => {
    expect(createMediaActionHost('grid', async () => {}).dataset.pppHidden).toBe('true');
    expect(createMediaActionHost('closeup', async () => {}).dataset.pppHidden).toBeUndefined();
  });

  it('carries the scope so the stylesheet can size the pair', () => {
    expect(actionsOf(createMediaActionHost('grid', async () => {})).dataset.scope).toBe('grid');
    expect(actionsOf(createMediaActionHost('closeup', async () => {})).dataset.scope).toBe('closeup');
    expect(actionsOf(createMediaActionHost('row', async () => {})).dataset.scope).toBe('row');
  });

  it('shows a footer pair at once, at the size of the menu beside it', () => {
    const host = createMediaActionHost('row', async () => {}, 20);

    expect(host.dataset.pppHidden).toBeUndefined();
    expect(host.style.height).toBe('20px');
    expect(host.style.pointerEvents).toBe('auto');
  });

  it('runs the action for the button that was pressed', () => {
    const ran: string[] = [];
    const host = createMediaActionHost('grid', async (action) => { ran.push(action); });

    for (const pressed of actionsOf(host).querySelectorAll<HTMLButtonElement>('.ppp-action')) pressed.click();

    expect(ran).toEqual(['copy', 'download']);
  });

  it('keeps the click off the link the pin is wrapped in', () => {
    const link = document.createElement('a');
    link.href = 'https://www.pinterest.com/pin/1/';
    const host = createMediaActionHost('grid', async () => {});
    link.append(host);
    document.body.append(link);
    let opened = 0;
    link.addEventListener('click', () => { opened += 1; });

    // A real click crosses the shadow boundary; a synthetic one must say so.
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    actionsOf(host).querySelector<HTMLButtonElement>('.ppp-action')!.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(opened).toBe(0);
    link.remove();
  });

  it('keeps a mouse press from moving focus into the card it sits in', () => {
    const card = document.createElement('div');
    const host = createMediaActionHost('row', async () => {});
    card.append(host);
    document.body.append(card);
    let reachedCard = 0;
    card.addEventListener('mousedown', () => { reachedCard += 1; });

    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
    actionsOf(host).querySelector<HTMLButtonElement>('.ppp-action')!.dispatchEvent(press);

    // Pinterest re-lays a card out when focus enters it, moving the button
    // away before the release; a cancelled press does not move focus.
    expect(press.defaultPrevented).toBe(true);
    expect(reachedCard).toBe(0);
    card.remove();
  });
});

describe('setActionsVisible', () => {
  it('reveals and hides through the host, whatever it is laid over', () => {
    const host = createMediaActionHost('grid', async () => {});

    setActionsVisible(host, true);
    expect(host.dataset.pppHidden).toBeUndefined();
    setActionsVisible(host, false);
    expect(host.dataset.pppHidden).toBe('true');
  });

  it('stops a hidden host from taking clicks where it was last placed', () => {
    const host = createMediaActionHost('grid', async () => {});
    expect(host.style.pointerEvents).toBe('none');

    setActionsVisible(host, true);
    expect(host.style.pointerEvents).toBe('auto');
    setActionsVisible(host, false);
    expect(host.style.pointerEvents).toBe('none');
  });
});
