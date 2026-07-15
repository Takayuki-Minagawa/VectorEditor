import { describe, expect, it } from 'vitest';
import { HistoryService } from './historyService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('HistoryService', () => {
  it('serializes restore tasks and reports restoring state around the full queue', async () => {
    const service = new HistoryService();
    const gate = deferred<void>();
    const order: string[] = [];
    const restoring: boolean[] = [];
    service.setRestoringListener((value) => restoring.push(value));

    const first = service.enqueue(async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
      return 1;
    });
    const second = service.enqueue(async () => {
      order.push('second:start');
      order.push('second:end');
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    expect(service.isRestoring).toBe(true);

    gate.resolve();
    await expect(first).resolves.toEqual({ status: 'completed', value: 1 });
    await expect(second).resolves.toEqual({ status: 'completed', value: 2 });
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    expect(restoring).toEqual([false, true, false]);
  });

  it('uses finally semantics so a failed restore cannot poison the queue', async () => {
    const service = new HistoryService();

    await expect(service.enqueue(async () => {
      throw new Error('broken snapshot');
    })).rejects.toThrow('broken snapshot');
    await expect(service.enqueue(async () => 'recovered')).resolves.toEqual({
      status: 'completed',
      value: 'recovered',
    });
    expect(service.isRestoring).toBe(false);
    expect(service.isHistorySuspended).toBe(false);
  });

  it('invalidates stale work before applying a different document', async () => {
    const service = new HistoryService();
    const gate = deferred<void>();
    const first = service.enqueue(async () => {
      await gate.promise;
      return 'old';
    });
    const replacement = service.runDocumentRestore(async () => 'new');

    gate.resolve();
    await expect(first).resolves.toEqual({ status: 'skipped' });
    await expect(replacement).resolves.toEqual({ status: 'completed', value: 'new' });
  });

  it('always releases an explicit history suspension', async () => {
    const service = new HistoryService();
    await expect(service.withHistorySuspended(async () => {
      expect(service.isHistorySuspended).toBe(true);
      throw new Error('failure');
    })).rejects.toThrow('failure');
    expect(service.isHistorySuspended).toBe(false);
  });
});
