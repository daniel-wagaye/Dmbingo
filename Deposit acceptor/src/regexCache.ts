import { Database, RegexRow } from './db';

export type CompiledConfig = {
  bankName: string;
  senderName: string;
  txnRe: RegExp;
  amountRe: RegExp;
  meta?: Record<string, unknown>;
};

export type RegexMap = Map<string, CompiledConfig[]>;

export class RegexCache {
  private mapRef: RegexMap = new Map();

  get snapshot(): RegexMap {
    return this.mapRef;
  }

  private compileRow(row: RegexRow): CompiledConfig {
    const obj = row.regex_json as any;
    if (!obj || typeof obj !== 'object') throw new Error(`Row ${row.id} regex_json is not an object`);
    const senderName = obj['sender-name'];
    const amtPat = obj['amount-pattern'];
    const txnPat = obj['transaction-id-pattern'];
    if (!senderName || !amtPat || !txnPat) {
      throw new Error(`Row ${row.id} missing required regex_json keys`);
    }
    let txnRe: RegExp;
    let amountRe: RegExp;
    try {
      txnRe = new RegExp(txnPat, 'iu');
      amountRe = new RegExp(amtPat, 'iu');
    } catch (e) {
      throw new Error(`Row ${row.id} regex compile failed: ${(e as Error).message}`);
    }
    return {
      bankName: row.bank_name,
      senderName: String(senderName),
      txnRe,
      amountRe,
    };
  }

  async reloadAll(db: Database): Promise<number> {
    const rows = await db.fetchActiveRegex();
    const nextMap: RegexMap = new Map();
    for (const row of rows) {
      const compiled = this.compileRow(row);
      const arr = nextMap.get(compiled.senderName) ?? [];
      arr.push(compiled);
      nextMap.set(compiled.senderName, arr);
    }
    this.mapRef = nextMap;
    return rows.length;
  }
}

export function createRegexCache() {
  return new RegexCache();
}
