export class KeyLock {
  private queues: Map<string, Array<() => void>> = new Map();

  private acquire(key: string): Promise<void> {
    const q = this.queues.get(key) ?? [];
    const p = new Promise<void>((resolve) => {
      q.push(resolve);
      if (q.length === 1) resolve();
    });
    this.queues.set(key, q);
    return p;
  }

  private release(key: string) {
    const q = this.queues.get(key);
    if (!q) return;
    q.shift();
    if (q.length === 0) this.queues.delete(key);
    else q[0]!();
  }

  async withKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(key);
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }
}

export function createKeyLock() {
  return new KeyLock();
}
