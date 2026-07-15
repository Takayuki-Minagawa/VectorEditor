export type QueuedTaskResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'skipped' };

type RestoringListener = (restoring: boolean) => void;
type DocumentRestoredListener = (snapshot: object) => void;

/**
 * Serialises asynchronous canvas restores and invalidates obsolete queued
 * work when a different document is opened.  Fabric's loadFromJSON mutates a
 * canvas asynchronously, so allowing two calls to overlap can leave the
 * history index and rendered objects describing different states.
 */
export class HistoryService {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private mutationEpoch = 0;
  private abortController = new AbortController();
  private pendingTasks = 0;
  private explicitSuspensions = 0;
  private restoringListener: RestoringListener | null = null;
  private documentRestoredListener: DocumentRestoredListener | null = null;

  get isRestoring(): boolean {
    return this.pendingTasks > 0;
  }

  get isHistorySuspended(): boolean {
    return this.isRestoring || this.explicitSuspensions > 0;
  }

  /** Ownership token for external document restores. */
  get currentGeneration(): number {
    return this.generation;
  }

  /** Token used to discard async edits that started before a restore. */
  get currentMutationEpoch(): number {
    return this.mutationEpoch;
  }

  isMutationEpochCurrent(epoch: number): boolean {
    return epoch === this.mutationEpoch && !this.isRestoring;
  }

  setRestoringListener(listener: RestoringListener | null): void {
    this.restoringListener = listener;
    listener?.(this.isRestoring);
  }

  setDocumentRestoredListener(listener: DocumentRestoredListener | null): void {
    this.documentRestoredListener = listener;
  }

  notifyDocumentRestored(snapshot: object): void {
    this.documentRestoredListener?.(snapshot);
  }

  /** Cancel queued history work. Running Fabric work receives an abort signal. */
  invalidate(): void {
    this.generation += 1;
    this.mutationEpoch += 1;
    this.abortController.abort();
    this.abortController = new AbortController();
  }

  enqueue<T>(task: (signal: AbortSignal) => Promise<T>): Promise<QueuedTaskResult<T>> {
    this.mutationEpoch += 1;
    const taskGeneration = this.generation;
    const signal = this.abortController.signal;
    this.setPendingTasks(this.pendingTasks + 1);

    const queued = this.tail.then(async (): Promise<QueuedTaskResult<T>> => {
      if (taskGeneration !== this.generation || signal.aborted) {
        return { status: 'skipped' };
      }

      try {
        const value = await task(signal);
        if (taskGeneration !== this.generation || signal.aborted) {
          return { status: 'skipped' };
        }
        return { status: 'completed', value };
      } catch (error) {
        if (taskGeneration !== this.generation || signal.aborted) {
          return { status: 'skipped' };
        }
        throw error;
      }
    });

    // A rejected task must not poison later restores.  The returned promise
    // still carries the error to its caller.
    this.tail = queued.then(
      () => undefined,
      () => undefined,
    );

    return queued.finally(() => {
      this.setPendingTasks(this.pendingTasks - 1);
    });
  }

  /**
   * Run an external document restore in the same queue.  Existing undo/redo
   * requests are invalidated before the new document is applied.
   */
  runDocumentRestore<T>(task: (signal: AbortSignal) => Promise<T>): Promise<QueuedTaskResult<T>> {
    this.invalidate();
    return this.enqueue(task);
  }

  async withHistorySuspended<T>(task: () => T | Promise<T>): Promise<T> {
    this.explicitSuspensions += 1;
    try {
      return await task();
    } finally {
      this.explicitSuspensions = Math.max(0, this.explicitSuspensions - 1);
    }
  }

  private setPendingTasks(value: number): void {
    const wasRestoring = this.isRestoring;
    this.pendingTasks = Math.max(0, value);
    if (wasRestoring !== this.isRestoring) {
      this.restoringListener?.(this.isRestoring);
    }
  }
}

export const historyService = new HistoryService();
