import { digest, freshQuote } from './ledger.js';
import { liveQuotes } from './quotes.js';
import { paperMarket, units, validMarketAsset, type MarketAsset, type MarketSelection } from './types.js';

export class IntentMarkets {
  private snapshot?:{assets:MarketAsset[];fetchedAt:number};
  private pending?:Promise<{assets:MarketAsset[];fetchedAt:number}>;
  private readonly fetcher:typeof fetch;
  private readonly now:()=>number;

  constructor(fetcher=fetch,now=Date.now) {this.fetcher=fetcher;this.now=now;}

  async catalog() {
    if(this.snapshot&&this.now()-this.snapshot.fetchedAt<5*60_000)return this.snapshot;
    return this.pending??=this.load().finally(()=>{this.pending=undefined;});
  }

  private async load() {
    const response=await this.fetcher('https://1click.chaindefuser.com/v0/tokens',{redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('The NEAR Intents asset catalog is unavailable. Try again shortly.');
    const text=await response.text();
    if(text.length>2*1024*1024)throw new Error('The NEAR Intents asset catalog exceeds the supported response size.');
    const rows:unknown=JSON.parse(text);
    if(!Array.isArray(rows)||!rows.length)throw new Error('The NEAR Intents asset catalog is empty or malformed.');
    const assets=rows.map(row=>{
      const asset={assetId:row?.assetId,blockchain:row?.blockchain,decimals:row?.decimals,symbol:row?.symbol};
      if(!validMarketAsset(asset))throw new Error('NEAR Intents returned unsupported asset metadata.');
      return asset;
    });
    if(new Set(assets.map(a=>a.assetId)).size!==assets.length)throw new Error('The NEAR Intents catalog contains duplicate asset IDs.');
    return this.snapshot={assets,fetchedAt:this.now()};
  }

  async check(selection:MarketSelection,amount:string,slippageBps:number) {
    if(!selection||typeof selection!=='object'||Object.keys(selection).sort().join()!=='base,quote'||
       !validMarketAsset(selection.base)||!validMarketAsset(selection.quote)||selection.base.assetId===selection.quote.assetId)
      throw new Error('Choose two different NEAR Intents assets.');
    const {assets}=await this.catalog(),{base,quote,quoteDecimals}=paperMarket({market:selection});
    if([selection.base,selection.quote].some(asset=>{
      const current=assets.find(a=>a.assetId===asset.assetId);
      return !current||digest(current)!==digest(asset);
    }))throw new Error('Asset metadata changed. Refresh the NEAR Intents catalog and select the pair again.');
    if(units(amount,false)>1_000_000n*10n**BigInt(quoteDecimals)||!Number.isSafeInteger(slippageBps)||slippageBps<0||slippageBps>1000)
      throw new Error('Enter a valid per-order cap and slippage tolerance before checking the pair.');
    const quotes=liveQuotes(this.fetcher,this.now,selection);
    const policy={config:{source:'live' as const,maxQuoteAgeMs:30000}};
    const entry=await quotes.get(quote,base,amount,slippageBps).catch((error:Error)=>{throw new Error('Buy quote unavailable. '+error.message);});
    freshQuote(entry,policy,this.now());
    const exit=await quotes.get(base,quote,entry.amountOut,slippageBps).catch((error:Error)=>{throw new Error('Sell quote unavailable. '+error.message);});
    freshQuote(exit,policy,this.now());
    return {entryId:entry.id,exitId:exit.id,checkedAt:exit.receivedAt};
  }
}
