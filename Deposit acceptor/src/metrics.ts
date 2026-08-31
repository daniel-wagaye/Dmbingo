export type CounterKeys =
  | 'deposit_requests_total'
  | 'deposit_inserts_total'
  | 'deposit_duplicates_total'
  | 'regex_reload_total'
  | 'rate_limit_exceeded_total';

export class Metrics {
  private counters: Record<CounterKeys, number> = {
    deposit_requests_total: 0,
    deposit_inserts_total: 0,
    deposit_duplicates_total: 0,
    regex_reload_total: 0,
    rate_limit_exceeded_total: 0,
  };

  inc(key: CounterKeys, by = 1) {
    this.counters[key] += by;
  }
  get(key: CounterKeys) {
    return this.counters[key];
  }
  snapshot() {
    return { ...this.counters };
  }
}

export function createMetrics() {
  return new Metrics();
}
