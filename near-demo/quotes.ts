import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { digest } from './ledger.js';
import { USDC, QUOTE_CONTEXT, markets, paperMarket, units, type Quote, type MarketSelection } from './types.js';
export type QuoteProvider = { get(tokenIn:string,tokenOut:string,amountIn:string,slippageBps:number):Promise<Quote> };
export function liveQuotes(fetcher=fetch, now=Date.now, selection?:MarketSelection,
  apiKey=typeof process==='undefined'?undefined:process.env.PUMPCOIN_ONECLICK_API_KEY): QuoteProvider {
  return { async get(tokenIn,tokenOut,amountIn,slippageBps) {
    const custom=typeof selection==='object';
    const candidates=selection===undefined?Object.values(markets):[paperMarket({market:selection})];
    const market = candidates.find(m =>
      tokenIn === m.quote && tokenOut === m.base || tokenIn === m.base && tokenOut === m.quote);
    if (!market) throw new Error('Unsupported demo market.');
    units(amountIn,false);
    // A public placeholder for dry-run EVM address validation, never a payment address.
    const context = custom || market.quote === USDC ? QUOTE_CONTEXT : '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';
    const request={dry:true,swapType:'EXACT_INPUT',slippageTolerance:slippageBps,originAsset:tokenIn,depositType:custom?'INTENTS':'ORIGIN_CHAIN',destinationAsset:tokenOut,amount:amountIn,refundTo:context,refundType:custom?'INTENTS':'ORIGIN_CHAIN',recipient:context,recipientType:custom?'INTENTS':'DESTINATION_CHAIN',deadline:new Date(now()+600000).toISOString()};
    const fetchQuote = async (body = request) => {
      const response=await fetcher('https://1click.chaindefuser.com/v0/quote',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(apiKey?{'X-API-Key':apiKey}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
      return { response, text: await response.text() };
    };
    const isTransportFailure = (error: unknown) => error instanceof Error &&
      ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name);
    const fetchWithRetry = async (body:typeof request) => {
      let result;
      try {
        result = await fetchQuote(body);
        if (![500, 502, 503, 504].includes(result.response.status)) return result;
      } catch (error) {
        if (!isTransportFailure(error)) throw error;
      }
      try {
        return await fetchQuote(body);
      } catch (error) {
        if (!isTransportFailure(error)) throw error;
        throw new Error('Could not reach NEAR Intents 1Click for a live dry-run quote after two attempts.', { cause: error });
      }
    };
    let result = await fetchWithRetry(request);
    let expected = request;
    if (!custom && market.quote === USDC && result.response.status === 400 && result.text.length <= 131072) {
      let unavailable = false;
      try { unavailable = JSON.parse(result.text)?.message === 'Quoting for this pair is not available'; } catch { /* Keep the HTTP error for malformed responses. */ }
      if (unavailable) {
        expected = {...request, depositType:'INTENTS', refundType:'INTENTS', recipientType:'INTENTS'};
        result = await fetchWithRetry(expected);
      }
    }
    const { response, text } = result;
    if(!response.ok) {
      let detail='';
      if(text.length<=131072)try {
        const message=JSON.parse(text)?.message;
        if(typeof message==='string'&&message.length<=160)detail=' '+message.replace(/[\r\n]/g,' ');
      } catch { /* A non-JSON response still has an HTTP status. */ }
      throw new Error(`NEAR Intents 1Click returned HTTP ${response.status} for the dry-run quote.${detail}`);
    }
    if(text.length>131072) throw new Error('NEAR Intents 1Click returned an oversized dry-run quote.');
    const raw=JSON.parse(text), r=raw.quoteRequest, q=raw.quote;
    if (!r || r.dry!==true || r.originAsset!==tokenIn || r.destinationAsset!==tokenOut || r.amount!==amountIn || r.recipient!==expected.recipient || r.refundTo!==expected.refundTo || r.swapType!=='EXACT_INPUT' || r.slippageTolerance!==slippageBps || r.depositType!==expected.depositType || r.refundType!==expected.refundType || r.recipientType!==expected.recipientType || raw.quote?.depositAddress) throw new Error('Quote response does not match the dry-only request.');
    if (!verifyQuoteSignature(raw)) throw new Error('1Click quote authenticity check failed.');
    if(q.amountIn!==amountIn)throw new Error('Quote input changed.'); units(q.amountOut,false); units(q.minAmountOut);
    return {source:'live',id:digest(raw),observedAt:raw.timestamp,receivedAt:new Date(now()).toISOString(),tokenIn,tokenOut,amountIn,amountOut:q.amountOut,minimumOut:q.minAmountOut,signatureVerified:true,raw};
  }};
}
/** Deliberately separate synthetic scenario: never a fallback for unavailable live quotes. */
export function scenarioQuotes(now=Date.now): QuoteProvider {
  return {async get(tokenIn,tokenOut,amountIn,slippageBps) {
    const input=units(amountIn,false), price=5_000_000n, scale=10n**24n;
    const output=(tokenIn===USDC?input*scale/price:input*price/scale)*997n/1000n;
    if(output===0n)throw new Error('Scenario order below precision.');
    const raw={fixture:'fixed-5-USDC-per-wNEAR',assumedFeeBps:30,tokenIn,tokenOut,amountIn,amountOut:String(output)};
    return {source:'replay',id:digest(raw),observedAt:new Date(now()).toISOString(),receivedAt:new Date(now()).toISOString(),tokenIn,tokenOut,amountIn,amountOut:String(output),minimumOut:String(output*BigInt(10000-slippageBps)/10000n),signatureVerified:false,raw};
  }};
}
