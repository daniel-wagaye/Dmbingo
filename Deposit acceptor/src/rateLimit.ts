type NowFn = () => number;

export class SlidingWindowLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly buckets: Map<string, number[]> = new Map();
  private readonly now: NowFn;

  constructor(max: number, windowMs: number, now: NowFn = () => Date.now()) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  allow(key: string): boolean {
    const t = this.now();
    const from = t - this.windowMs;
    const list = this.buckets.get(key) ?? [];
    let i = 0;
    while (i < list.length && list[i] < from) i++;
    if (i > 0) list.splice(0, i);
    if (list.length >= this.max) {
      this.buckets.set(key, list);
      return false;
    }
    list.push(t);
    this.buckets.set(key, list);
    return true;
  }
}

export class MinIntervalGate {
  private readonly minIntervalMs: number;
  private lastAt = 0;
  private readonly now: NowFn;
  constructor(minIntervalMs: number, now: NowFn = () => Date.now()) {
    this.minIntervalMs = minIntervalMs;
    this.now = now;
  }
  allow(): boolean {
    const t = this.now();
    if (t - this.lastAt < this.minIntervalMs) return false;
    this.lastAt = t;
    return true;
  }
}
