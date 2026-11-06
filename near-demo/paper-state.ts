import { units, type Portfolio, type Session } from './types.js';

export function canonical(v: unknown): string {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isSafeInteger(v))) return JSON.stringify(v);
  if (Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return '{'+Object.keys(v).sort().filter(k => (v as any)[k] !== undefined).map(k => JSON.stringify(k)+':'+canonical((v as any)[k])).join(',')+'}';
  throw new Error('Unsupported evidence encoding.');
}

export function initialPortfolio(cash: string): Portfolio { units(cash,false); return { cash, position:'0', cost:'0', realized:'0', equity:cash, peak:cash, drawdownBps:0, maxDrawdownBps:0, markAt:null }; }

export function metrics(s: Session) {
  const p = s.portfolio, total = p.equity === null ? null : BigInt(p.equity)-units(s.config.initialCash);
  return { total:total?.toString() ?? null, realized:p.realized, unrealized:total === null ? null : String(total-BigInt(p.realized)), returnBps:total === null ? null : Number(total*10000n/units(s.config.initialCash)), costModel:'Quoted output includes route economics; network gas and setup costs excluded.', exposurePolicy:'Allocated purchase cost; not a continuous marked-exposure guarantee.' };
}
