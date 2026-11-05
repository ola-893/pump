import type { ExecutionExercise } from './exercise.js';
export const TESTNET_RPC = 'https://test.rpc.fastnear.com';
export const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const WNEAR = 'nep141:wrap.near';
export const ETH = 'nep141:eth.omft.near';
export const ARBITRUM_USDC = 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near';
export const markets = {
  'near-usdc': {base:WNEAR, quote:USDC, symbol:'wNEAR', decimals:24, quoteSymbol:'USDC', quoteDecimals:6, label:'wNEAR / USDC', candles:'NEARUSDT'},
  'eth-usdc': {base:ETH, quote:ARBITRUM_USDC, symbol:'ETH', decimals:18, quoteSymbol:'USDC', quoteDecimals:6, label:'ETH / USDC (Arbitrum USDC)', candles:'ETHUSDC'},
} as const;
export type MarketId = keyof typeof markets;
export type MarketAsset = {assetId:string;symbol:string;blockchain:string;decimals:number};
export type MarketSelection = MarketId | {base:MarketAsset;quote:MarketAsset};
export function validMarketAsset(value:unknown): value is MarketAsset {
  const a=value as MarketAsset;
  return !!a && typeof a==='object' && Object.keys(a).sort().join()==='assetId,blockchain,decimals,symbol' &&
    typeof a.assetId==='string' && /^[\x21-\x7e]{1,180}$/.test(a.assetId) &&
    typeof a.symbol==='string' && a.symbol.trim().length>0 && a.symbol.length<=48 && !/[\x00-\x1f\x7f]/.test(a.symbol) &&
    typeof a.blockchain==='string' && /^[a-z0-9-]{1,24}$/.test(a.blockchain) &&
    Number.isSafeInteger(a.decimals) && a.decimals>=0 && a.decimals<=30;
}
export function paperMarket(config?:{market?:MarketSelection}) {
  const selection=config?.market??'near-usdc';
  if(typeof selection==='string')return markets[selection];
  const {base,quote}=selection;
  return {base:base.assetId,quote:quote.assetId,symbol:base.symbol,decimals:base.decimals,quoteSymbol:quote.symbol,quoteDecimals:quote.decimals,
    label:`${base.symbol} (${base.blockchain}) / ${quote.symbol} (${quote.blockchain})`,candles:null};
}
export function marketObservationSize(config:{market?:MarketSelection;tradeCap:string}) {
  return typeof config.market==='object'?config.tradeCap:'1000000';
}
export function vaultEquity(config:{market?:MarketSelection;initialCash:string},equity:string) {
  // A custom market pays its native quote-currency return into a USDC vault.
  return typeof config.market==='object'?String(units(equity)*1000000n/units(config.initialCash,false)):equity;
}
export const TEST_USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';
export const QUOTE_CONTEXT = 'intents.near'; // Quote-only placeholder; never a payment instruction.
export type TestnetConfig={network:'testnet';controllerId:string;reporterId:string;contractId:string|null;tokenId:typeof TEST_USDC};
export type WalletPlan={network:'testnet';signerId:string;receiverId:string;actions:{type:'FunctionCall';params:{methodName:string;args:Record<string,unknown>;gas:string;deposit:string}}[];description:string};
export type Quote = {
  source: 'live' | 'replay'; id: string; observedAt: string; receivedAt: string;
  tokenIn: string; tokenOut: string; amountIn: string; amountOut: string; minimumOut: string;
  signatureVerified: boolean; raw: unknown;
};
export type Proposal = { action: 'BUY' | 'SELL' | 'HOLD'; quoteUnits: string; reason: string };
export type Portfolio = { cash: string; position: string; cost: string; realized: string; equity: string | null; peak: string; drawdownBps: number | null; maxDrawdownBps: number; markAt: string | null };
export type Config = { name: string; initialCash: string; tradeCap: string; exposureCap: string; dailyTurnoverCap: string; slippageBps: number; executionDelayMs: number; maxQuoteAgeMs: number; source: 'live' | 'replay'; endpoint: string; strategy: string; intervalMs: number; market?:MarketSelection };
export type Session = { exercise?:ExecutionExercise; agent?: { id: string; modelId: string; weightsHash: string; strategyRunId?:string }; id: string; version: 1; createdAt: string; config: Config; portfolio: Portfolio; revision: number; sequence: number; head: string | null; state: 'stopped' | 'running'; turnover: { day: string; used: string }; testnet?: { account: string; initialClaim: string; settlementPrepared?: boolean }; };
export type Event = { id: string; sessionId: string; sequence: number; previousHash: string | null; at: string; exercise?:ExecutionExercise; exerciseId?:string; operatorExit?: { expectedPosition:string; lastFillHash:string }; dust?: { policy: 'PUMP-PAPER-DUST-v1'; saleHash: string }; kind: 'dust' | 'mandate' | 'fill' | 'hold' | 'blocked' | 'mark' | 'model' | 'testnet-link'; action?: 'BUY' | 'SELL'; evidence: 'operator-exit' | 'paper-adjustment' | 'operator-directed-model' | 'operator-mandate' | 'live-local-model' | 'manual-scenario' | 'quote-mark' | 'testnet-observation'; reason: string; quote?: Quote; model?: { id: string; request: unknown; raw: string; proposal: Proposal }; before: Portfolio; after: Portfolio; hash: string };
export function units(value: unknown, allowZero = true): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,37})$/.test(value)) throw new Error('Amounts must be non-negative integer base units.');
  const n = BigInt(value); if (!allowZero && n === 0n) throw new Error('Amount must be positive.'); return n;
}
export function testAccount(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || !(/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(value) || /^[a-f0-9]{64}$/.test(value))) throw new Error('Use a NEAR testnet named or implicit account.');
  return value;
}
export function validateConfig(input: unknown): Config {
  const c = input as Config;
  if (!c || Object.keys(c).filter(k=>k!=='market').sort().join() !== 'dailyTurnoverCap,endpoint,executionDelayMs,exposureCap,initialCash,intervalMs,maxQuoteAgeMs,name,slippageBps,source,strategy,tradeCap') throw new Error('Invalid paper configuration fields.');
  if (Object.hasOwn(c,'market')) {
    const m=c.market;
    const valid=typeof m==='string'?Object.hasOwn(markets,m):m && Object.keys(m).sort().join()==='base,quote' && validMarketAsset(m.base) && validMarketAsset(m.quote) && m.base.assetId!==m.quote.assetId;
    if(!valid||m!=='near-usdc'&&c.source!=='live')throw new Error('Unsupported paper market or quote source.');
  }
  if (!['live','replay'].includes(c.source) || typeof c.name !== 'string' || c.name.trim().length < 1 || c.name.length > 64 || typeof c.strategy !== 'string' || c.strategy.length > 3000) throw new Error('Provide an agent name, strategy and quote source.');
  const max=1_000_000n*10n**BigInt(paperMarket(c).quoteDecimals);
  for (const key of ['initialCash','tradeCap','exposureCap','dailyTurnoverCap'] as const) if (units(c[key], false) > max) throw new Error('Demo quote limits must be at most one million units of the quote currency.');
  if (units(c.tradeCap) > units(c.exposureCap) || units(c.tradeCap) > units(c.dailyTurnoverCap)) throw new Error('Per-trade cap exceeds exposure or daily turnover.');
  for (const [key,min,max] of [['slippageBps',0,1000],['executionDelayMs',1000,30000],['maxQuoteAgeMs',5000,60000],['intervalMs',15000,3600000]] as const) if (!Number.isSafeInteger(c[key]) || c[key] < min || c[key] > max) throw new Error(`Invalid ${key}.`);
  const u = new URL(c.endpoint);
  if (u.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || !['/','/v1','/v1/'].includes(u.pathname)) throw new Error('Inference must use a literal loopback HTTP endpoint.');
  return { ...c, name: c.name.trim(), endpoint: u.href };
}

export type VaultEffect={kind:'setup'|'deposit'|'withdraw'|'reserve'|'operator';outcome:'confirmed'|'refunded'|'restored'|'unverified';assets?:string;shares?:string;accountId?:string;receiverId?:string;method?:string};
