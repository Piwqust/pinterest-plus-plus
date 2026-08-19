import { describe, expect, it } from 'vitest';
import { withTimeout } from '../shared/async';
import { SequentialTaskQueue, firstSuccessfulCandidate } from '../shared/candidate-processing';

describe('media candidate processing', () => {
  it('continues when a fetched candidate cannot be decoded', async () => {
    const attempted: string[] = [];
    const result = await firstSuccessfulCandidate(
      ['original', 'thumbnail'],
      async (candidate) => {
        attempted.push(candidate);
        if (candidate === 'original') throw new Error('Decode failed');
        return candidate;
      },
      'No usable source',
    );

    expect(result).toBe('thumbnail');
    expect(attempted).toEqual(['original', 'thumbnail']);
  });

  it('serializes stateful media work', async () => {
    const queue = new SequentialTaskQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.run(async () => {
      order.push('first-start');
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push('first-end');
    });
    const second = queue.run(async () => { order.push('second'); });

    await Promise.resolve();
    expect(order).toEqual(['first-start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('rejects stalled operations instead of leaving an action pending', async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 1, 'Timed out')).rejects.toThrow('Timed out');
  });
});
