export interface BudgetRecord { day: string; spent: number; reserved: number }

export function validBudget(value: unknown): value is BudgetRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 && typeof record.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.day)
    && typeof record.spent === 'number' && Number.isFinite(record.spent) && record.spent >= 0
    && typeof record.reserved === 'number' && Number.isFinite(record.reserved) && record.reserved >= 0;
}

/** An unavailable durable ledger must prevent paid providers from starting. */
export function remoteBudgetStore(fetcher: typeof fetch = fetch, url = 'http://budget.internal/ledger', epoch = '') {
  const headers = { 'x-budget-epoch': epoch };
  return {
    async load(): Promise<BudgetRecord | null> {
      const response = await fetcher(url, { headers, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('The durable AI budget ledger is unavailable.');
      const value: unknown = await response.json();
      if (value !== null && !validBudget(value)) throw new Error('The durable AI budget ledger is invalid.');
      return value;
    },
    async save(record: BudgetRecord): Promise<void> {
      if (!validBudget(record)) throw new Error('Cannot persist an invalid AI budget ledger.');
      const response = await fetcher(url, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(record), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('The durable AI budget ledger could not be saved.');
    },
  };
}
