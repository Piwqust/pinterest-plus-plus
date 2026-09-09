import { beforeEach, describe, expect, it } from 'vitest';
import { createMediaActionHost, setActionChip } from '../shared/media-action-host';

function actionsOf(host: HTMLElement): HTMLElement {
  return host.shadowRoot!.querySelector<HTMLElement>('.ppp-pin-actions')!;
}

describe('setActionChip', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = createMediaActionHost('grid', async () => {});
  });

  it('leaves the buttons bare until a chip is asked for', () => {
    expect(actionsOf(host).dataset.chip).toBeUndefined();
  });

  it("wears the neighbour's measurements", () => {
    setActionChip(host, { background: 'rgb(255, 255, 255)', radius: '12px', size: 40 });

    expect(actionsOf(host).dataset.chip).toBe('true');
    expect(host.style.getPropertyValue('--ppp-chip-bg')).toBe('rgb(255, 255, 255)');
    expect(host.style.getPropertyValue('--ppp-chip-radius')).toBe('12px');
    expect(host.style.getPropertyValue('--ppp-chip-size')).toBe('40px');
    expect(host.style.getPropertyValue('--ppp-chip-icon')).toBe('22px');
    // The row reserves the host's height, so an unresized host would clip.
    expect(host.style.height).toBe('40px');
  });

  it('falls back to a chip of its own size when the neighbour was unmeasurable', () => {
    setActionChip(host, { background: '#ffffff', radius: '50%' });

    expect(host.style.getPropertyValue('--ppp-chip-size')).toBe('32px');
    expect(host.style.height).toBe('32px');
  });

  it('returns to bare icons at a pin that grew a footer row', () => {
    setActionChip(host, { background: '#ffffff', radius: '50%', size: 40 });
    setActionChip(host, null);

    expect(actionsOf(host).dataset.chip).toBeUndefined();
    expect(host.style.getPropertyValue('--ppp-chip-bg')).toBe('');
    expect(host.style.getPropertyValue('--ppp-chip-size')).toBe('');
    expect(host.style.height).toBe('28px');
  });

  it('ignores a host that carries no buttons', () => {
    const bare = document.createElement('span');
    expect(() => setActionChip(bare, null)).not.toThrow();
  });
});
