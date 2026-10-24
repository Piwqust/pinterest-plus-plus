import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanPage } from '../shared/page-scan';

/** A feed that mounts the next `batch` pins every time the window scrolls, up to `total`. */
function feed(total: number, batch: number): () => void {
  let mounted = 0;
  const mount = () => {
    const next = Math.min(total, mounted + batch);
    for (let index = mounted; index < next; index += 1) {
      const pin = document.createElement('div');
      pin.dataset.testId = 'pinWrapper';
      pin.dataset.id = String(index);
      document.body.append(pin);
    }
    mounted = next;
  };
  mount();
  let y = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  window.scrollBy = (() => {
    if (mounted < total) {
      y += 100;
      mount();
    }
  }) as typeof window.scrollBy;
  return mount;
}

const settle = async () => {};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('page scan', () => {
  it('scrolls until the limit is collected', async () => {
    feed(100, 10);
    const taken = new Set<string>();
    const result = await scanPage({
      limit: 25,
      settle,
      collect: (pins) => {
        let added = 0;
        for (const pin of pins) {
          if (taken.size >= 25 || taken.has(pin.dataset.id!)) continue;
          taken.add(pin.dataset.id!);
          added += 1;
        }
        return added;
      },
    });
    expect(result).toEqual({ added: 25, reason: 'limit' });
  });

  it('stops at the end of a feed that stops growing', async () => {
    feed(12, 6);
    const result = await scanPage({ limit: 100, settle, collect: () => 0 });
    expect(result.reason).toBe('end');
  });

  it('stops when cancelled', async () => {
    feed(100, 10);
    const controller = new AbortController();
    const result = await scanPage({
      limit: 100,
      settle,
      signal: controller.signal,
      collect: () => {
        controller.abort();
        return 1;
      },
    });
    expect(result).toEqual({ added: 1, reason: 'cancelled' });
  });
});
