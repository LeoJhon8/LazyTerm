export type ConnectionReadinessCheckpoint =
  | "identity"
  | "listeners"
  | "backend"
  | "remote"
  | "first-data";

interface ReadinessWaiter {
  cycle: number;
  checkpoints: readonly ConnectionReadinessCheckpoint[];
  resolve: () => void;
  reject: (error: Error) => void;
}

function toReadinessError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/**
 * 协议无关的连接就绪屏障。
 *
 * 会话标识、事件监听、后端资源和远端可用性分别到达检查点；只有调用方
 * 要求的检查点全部完成后，等待任务才会放行。cycle 用于隔离已经过期的
 * 异步回调，避免旧连接在重连后污染新连接。
 */
export class ConnectionReadinessBarrier {
  private cycle = 0;
  private reached = new Set<ConnectionReadinessCheckpoint>();
  private failure: Error | null = null;
  private readonly waiters = new Set<ReadinessWaiter>();

  begin(initialCheckpoints: readonly ConnectionReadinessCheckpoint[] = []): number {
    const previousCycle = this.cycle;
    this.cycle += 1;
    this.reached = new Set(initialCheckpoints);
    this.failure = null;

    if (previousCycle > 0) {
      this.rejectWaiters(
        previousCycle,
        new Error("Connection readiness cycle was superseded"),
      );
    }

    return this.cycle;
  }

  mark(cycle: number, checkpoint: ConnectionReadinessCheckpoint): void {
    if (cycle !== this.cycle || this.failure) {
      return;
    }

    this.reached.add(checkpoint);
    this.flushWaiters();
  }

  has(
    cycle: number,
    checkpoints: readonly ConnectionReadinessCheckpoint[],
  ): boolean {
    return cycle === this.cycle
      && this.failure === null
      && checkpoints.every((checkpoint) => this.reached.has(checkpoint));
  }

  waitFor(
    cycle: number,
    checkpoints: readonly ConnectionReadinessCheckpoint[],
  ): Promise<void> {
    if (cycle !== this.cycle) {
      return Promise.reject(new Error("Connection readiness cycle is stale"));
    }
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    if (this.has(cycle, checkpoints)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.waiters.add({ cycle, checkpoints, resolve, reject });
    });
  }

  fail(cycle: number, reason: unknown): void {
    if (cycle !== this.cycle || this.failure) {
      return;
    }

    this.failure = toReadinessError(reason);
    this.rejectWaiters(cycle, this.failure);
  }

  private flushWaiters(): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.cycle !== this.cycle) {
        continue;
      }
      if (waiter.checkpoints.every((checkpoint) => this.reached.has(checkpoint))) {
        this.waiters.delete(waiter);
        waiter.resolve();
      }
    }
  }

  private rejectWaiters(cycle: number, error: Error): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.cycle === cycle) {
        this.waiters.delete(waiter);
        waiter.reject(error);
      }
    }
  }
}
