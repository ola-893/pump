import {RpcQueryError,testnetProvider} from './rpc.js';
import { Account, SignedTransaction, actions, baseEncode } from 'near-api-js';
import { createHash } from 'node:crypto';
import { readFileSync,existsSync } from 'node:fs';
import type { AgentVaults } from './agent-vaults.js';
import { canonical, digest, freshQuote } from './ledger.js';
import { liveQuotes, type QuoteProvider } from './quotes.js';
import { paperMarket, units, vaultEquity, type WalletPlan } from './types.js';

const GAS_RESERVATION = 5n * 10n ** 21n;
const APPROVAL_MS = 30_000;
const NAV_FRESH_MS = 60_000;
const FINALITY_MARGIN_MS = 8_000;
const CONFIRMED_REPORT = `json_extract(receipt,'$.final_execution_status')='FINAL'
  AND json_type(receipt,'$.status.SuccessValue') IS NOT NULL
  AND json_type(receipt,'$.transaction_outcome.outcome.status.Failure') IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM json_each(receipt,'$.receipts_outcome')
    WHERE json_type(value,'$.outcome.status.Failure') IS NOT NULL
  )`;

type NavOptions={autoStart?:boolean;now?:()=>number;quotes?:QuoteProvider;provider?:ReturnType<typeof testnetProvider>;credential?:{network:string;account_id:string;private_key:string}};
export class LiveVaultNav {
  private readonly vaults:AgentVaults;
  private timer?:ReturnType<typeof setInterval>;
  private tail:Promise<unknown>=Promise.resolve();
  private closed=false;
  private ticking=false;
  private errors=new Map<string,string>();

  private options:NavOptions;
  constructor(vaults:AgentVaults,options:NavOptions={}) {
    this.options=options;
    this.vaults=vaults;
    this.db.exec(`CREATE TABLE IF NOT EXISTS near_nav_reports
      (hash TEXT PRIMARY KEY, contract_id TEXT NOT NULL, day TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);
      CREATE INDEX IF NOT EXISTS near_nav_reports_contract ON near_nav_reports(contract_id);
      CREATE TABLE IF NOT EXISTS near_nav_budget (day TEXT PRIMARY KEY, spent TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS near_nav_health (run_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS near_nav_approval (contract_id TEXT PRIMARY KEY, until_ms INTEGER NOT NULL)`);
    for(const row of this.db.prepare('SELECT run_id,body FROM near_nav_health').all() as {run_id:string;body:string}[]){const h=JSON.parse(row.body);if(h.error)this.errors.set(row.run_id,h.error);}
    vaults.agents.strategies.beforeAction=async(run,action)=>{
      if(action==='start'||action==='cycle')await this.sync(run.id,true);
    };
    vaults.agents.strategies.afterAction=async(run)=>{void this.sync(run.id).catch(()=>{});};
    if(options.autoStart!==false){this.timer=setInterval(()=>void this.tick(),10000);this.timer.unref();}
  }
  private get db(){return this.vaults.agents.paper.store.db;}
  private now(){return this.options.now?.()??Date.now();}
  private health(runId:string,error:string|null){
    const row=this.db.prepare('SELECT body FROM near_nav_health WHERE run_id=?').get(runId) as {body:string}|undefined;
    const old=row?JSON.parse(row.body):{};
    const body=error?{error,firstFailureAt:old.error?old.firstFailureAt:this.now(),lastFailureAt:this.now(),attempts:(old.error?old.attempts:0)+1,lastSuccessAt:old.lastSuccessAt??null}:
      {error:null,lastSuccessAt:this.now(),attempts:0};
    this.db.prepare('INSERT INTO near_nav_health(run_id,body) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET body=excluded.body').run(runId,canonical(body));
  }
  status(){return [...this.errors].map(([runId,error])=>({runId,error,...JSON.parse((this.db.prepare('SELECT body FROM near_nav_health WHERE run_id=?').get(runId) as {body:string}|undefined)?.body??'{}')}));}
  evidence(runId:string){
    const row=this.db.prepare(`SELECT hash,contract_id,body,receipt FROM near_nav_reports WHERE json_extract(body,'$.args.run_id')=? AND ${CONFIRMED_REPORT} ORDER BY rowid DESC LIMIT 1`).get(runId) as {hash:string;contract_id:string;body:string;receipt:string}|undefined;
    if(!row)throw new Error('No confirmed automatic valuation is available yet.');
    const {args,valuation}=JSON.parse(row.body),receipt=JSON.parse(row.receipt);let history=null;
    if(valuation.sourceSession)try{history={session:valuation.sourceSession,events:this.vaults.agents.paper.store.history(valuation.sourceSession.id).filter(e=>e.sequence<=valuation.paperSequence)};}catch{/* Offline runner: quote and chain verification still remain available. */}
    return {schema:'PUMP-NAV-EVIDENCE-v1',contractId:row.contract_id,reporterId:receipt.transaction?.signer_id,runId,strategyHash:args.strategy_hash,transactionHash:row.hash,args,valuation,history,receipt};
  }
  close(){this.closed=true;clearInterval(this.timer);}
  async tick() {
    if(this.closed||this.ticking)return;
    this.ticking=true;
    try{for(const vault of this.vaults.list()) {
      if(!vault.liveNav||vault.archived)continue;
      await this.sync(vault.runId).catch(()=>{});
    }}finally{this.ticking=false;}
  }
  private enqueue<T>(work:()=>Promise<T>):Promise<T> {
    const task=this.tail.then(work);
    this.tail=task.catch(()=>{});
    return task;
  }
  private requireConfirmedNonce(contractId:string,observedNonce:number) {
    const latest=this.db.prepare(`SELECT json_extract(body,'$.args.expected_nonce') AS nonce
      FROM near_nav_reports WHERE contract_id=? AND ${CONFIRMED_REPORT}
      ORDER BY rowid DESC LIMIT 1`).get(contractId);
    if(latest&&observedNonce<=Number(latest.nonce))
      throw new Error('The testnet RPC has not caught up to the last confirmed vault price. Try again shortly.');
  }
  private approvalUntil(contractId:string):number {
    const row=this.db.prepare('SELECT until_ms FROM near_nav_approval WHERE contract_id=?').get(contractId);
    return Number(row?.until_ms??0);
  }
  private delegated(){
    return !this.options.credential&&!!process.env.PUMP_DIRECTORY_URL&&
      !existsSync(new URL('../.local/near-demo/testnet-deployer.json',import.meta.url));
  }
  async investorPlan(vaults:AgentVaults,agentId:string,action:string,account:string,amount:string,runId:string):Promise<{plans:WalletPlan[];approvalExpiresAt?:number}> {
    const plan=()=>vaults.plan(agentId,action,account,amount,runId);
    if(!['deposit','withdraw','redeem'].includes(action)||this.delegated())return {plans:await plan()};
    const vault=vaults.list().find(item=>item.agentId===agentId&&item.runId===runId);
    if(!vault?.liveNav||vault.archived)return {plans:await plan()};
    return this.enqueue(async()=>{
      if(this.approvalUntil(vault.contractId)>this.now())throw new Error('A wallet approval window is already open for this vault. Wait for it to expire before preparing another transaction.');
      const pending=this.db.prepare('SELECT 1 FROM near_nav_reports WHERE contract_id=? AND receipt IS NULL');
      if(pending.get(vault.contractId)){
        // Resolve the signed transaction before reserving a price for the wallet.
        try{
          await this.report(runId,vault.contractId,false);
          this.errors.delete(runId);this.health(runId,null);
        }catch(error){
          if(pending.get(vault.contractId))
            throw new Error('A price report is still confirming. Try again once the next confirmed price appears.',{cause:error});
          // A terminal failure cleared the outbox. The fresh read below can
          // still use a confirmed price or request a new one.
        }
      }
      for(let attempt=0;attempt<2;attempt++){
        const observation=await vaults.inspect(agentId,runId,account,true);
        this.requireConfirmedNonce(vault.contractId,observation.state.nonce);
        const nav=observation.state.live_nav;
        const usable=(expiresAt:number)=>!nav?.tracking||expiresAt+FINALITY_MARGIN_MS<=nav.observed_at_ms+NAV_FRESH_MS;
        if(usable(this.now()+APPROVAL_MS)){
          const plans=await vaults.plan(agentId,action,account,amount,runId,observation);
          const approvalExpiresAt=this.now()+APPROVAL_MS;
          if(usable(approvalExpiresAt)){
            // Keep the confirmed price nonce reserved through wallet approval.
            this.db.prepare('INSERT INTO near_nav_approval VALUES(?,?) ON CONFLICT(contract_id) DO UPDATE SET until_ms=excluded.until_ms').run(vault.contractId,approvalExpiresAt);
            return {plans,approvalExpiresAt};
          }
        }
        if(attempt===0){
          // Run within the existing queue slot so another report cannot take
          // the wallet window between confirmation and the fresh vault read.
          await this.report(runId,vault.contractId,false,true);
          this.errors.delete(runId);this.health(runId,null);
        }
      }
      throw new Error('A fresh vault price could not be held for wallet approval. Try again shortly.');
    });
  }
  sync(runId:string,starting=false):Promise<void> {
    return this.enqueue(async()=>{
      if(this.closed)return;
      const v=this.vaults.list().find(v=>v.runId===runId);
      if(!v?.liveNav||v.archived)return;
      if(this.approvalUntil(v.contractId)>this.now()){
        if(starting)throw new Error('A wallet approval window is open. Try starting again after it expires.');
        return;
      }
      try{await this.report(runId,v.contractId,starting);this.errors.delete(runId);this.health(runId,null);}
      catch(error){
        const message=error instanceof Error?error.message:'Live NAV reporting unavailable.';
        if(!message.startsWith('The portfolio changed')){this.errors.set(runId,message);this.health(runId,message);}
        if(starting)throw error;
      }
    });
  }
  private async report(runId:string, contractId:string, starting:boolean, forceFresh=false) {
    const agents=this.vaults.agents,run=agents.strategies.read(runId);
    if(this.delegated()){
      const v=await this.vaults.inspect(run.agentId,runId);
      if(starting&&!v.navFresh)throw new Error('Waiting for the shared reporter to confirm this strategy’s price.');
      return;
    }
    const provider=this.options.provider??testnetProvider();
    const pending=this.db.prepare('SELECT hash,body FROM near_nav_reports WHERE contract_id=? AND receipt IS NULL')
      .get(contractId) as {hash:string;body:string}|undefined;
    if(pending){
      const signed=SignedTransaction.decode(Buffer.from(JSON.parse(pending.body).signed,'base64'));
      const confirmed=await this.submitReport(provider,signed,pending.hash);
      if(starting||forceFresh||!confirmed)await this.report(runId,contractId,starting,forceFresh);
      return;
    }
    const session=agents.paper.store.read(run.sessionId);
    const bundle=agents.strategies.export(runId);
    const view=agents.paper.view(session);
    const position=units(session.portfolio.position);
    // Complete potentially queued RPC custody reads before obtaining a fresh quote.
    // Otherwise RPC backpressure consumes the quote's entire validity window.
    const observation=await this.vaults.inspect(run.agentId,run.id,'',true);
    this.requireConfirmedNonce(contractId,observation.state.nonce);
    const v=observation,nav=v.state.live_nav;
    if(!nav||v.state.archived)return;
    if(v.state.pending)throw new Error('Waiting for the pending payout before reporting NAV.');
    if(agents.paper.store.read(run.sessionId).revision!==session.revision)
      throw new Error('The portfolio changed during valuation. A fresh snapshot will retry.');
    const market=paperMarket(session.config);
    const quote=position>0n?await (this.options.quotes??liveQuotes(fetch,this.now.bind(this),session.config.market)).get(market.base,market.quote,session.portfolio.position,session.config.slippageBps):null;
    if(quote)freshQuote(quote,session,this.now());
    const nativeEquity=String(units(session.portfolio.cash)+(quote?units(quote.amountOut):0n));
    const equity=session.config?vaultEquity(session.config,nativeEquity):nativeEquity;
    const observedAt=quote?Date.parse(quote.receivedAt):this.now();
    const tracking=starting||view.state==='running'||position>0n;
    if(agents.paper.store.read(run.sessionId).revision!==session.revision)
      throw new Error('The portfolio changed during valuation. A fresh snapshot will retry.');
    if(this.now()-observedAt>30000)throw new Error('Liquidation quote became stale before reporting.');
    if(nav.equity===equity&&nav.tracking===tracking&&
       (!tracking||!forceFresh&&this.now()-nav.observed_at_ms<20000))return;
    const next=units(v.state.total_supply)===0n?0n:
      units(v.state.total_supply)*units(equity)/units(nav.reference_equity);
    if(next>units(v.state.assets)+units(v.state.reserve))
      throw new Error('Live gain needs more test USDC in this vault’s surplus. Last confirmed NAV retained.');
    const valuation={strategy:run.commitment,head:session.head,paperSequence:session.sequence,
      replay:bundle.paper.replay,portfolio:session.portfolio,sourceSession:session,...(session.config?.market?{strategyDefinition:run}:{}),originProof:(bundle as any).originProof??null,quote,equity,observedAt,tracking};

    const credential=this.options.credential??JSON.parse(readFileSync(new URL('../.local/near-demo/testnet-deployer.json',import.meta.url),'utf8'));
    if(credential.network!=='testnet'||credential.account_id!==v.reporterId||
        credential.account_id!==this.vaults.config().parentId)
      throw new Error('The configured testnet NAV reporter signer is unavailable.');
    const account=new Account(v.reporterId,provider,credential.private_key);
    const day=new Date(this.now()).toISOString().slice(0,10);
    const args={run_id:run.id,strategy_hash:run.commitment,equity,sequence:nav.sequence+1,
      observed_at_ms:observedAt,evidence_hash:digest(valuation),tracking,expected_nonce:v.state.nonce};
    const signed=await account.createSignedTransaction({receiverId:v.contractId,
      actions:[actions.functionCall('report_nav',args,30000000000000n,0n)]});
    if(this.closed)return;
    const hash=baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const budget=this.db.prepare('SELECT spent FROM near_nav_budget WHERE day=?').get(day) as {spent:string}|undefined;
      const spent=BigInt(budget?.spent??'0');
      // Account for pending gas in the journal. The funded testnet signer pays
      // for reports as they settle, independent of the UTC usage totals.
      this.db.prepare('INSERT INTO near_nav_budget(day,spent) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET spent=excluded.spent')
        .run(day,String(spent+GAS_RESERVATION));
      this.db.prepare('INSERT INTO near_nav_reports(hash,contract_id,day,body) VALUES(?,?,?,?)')
        .run(hash,v.contractId,day,canonical({args,valuation,signed:Buffer.from(signed.encode()).toString('base64')}));
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(!await this.submitReport(provider,signed,hash))throw new Error('Reporter nonce advanced. A fresh NAV report will retry.');
  }

  private async submitReport(provider:ReturnType<typeof testnetProvider>,signed:SignedTransaction,hash:string) {
    let receipt;
    try {
      receipt=await provider.sendTransactionUntil(signed,'FINAL');
    } catch(error) {
      if(!(error instanceof RpcQueryError)||!error.data?.data?.TxExecutionError?.InvalidTxError?.InvalidNonce)throw error;
      const tx=signed.transaction;
      const key=await provider.viewAccessKey({accountId:tx.signerId,publicKey:tx.publicKey,finalityQuery:{finality:'final'}});
      if(BigInt(key.nonce)<BigInt(tx.nonce))throw error;
      const statusQuery={tx_hash:hash,sender_account_id:tx.signerId};
      try {
        receipt=await provider.sendJsonRpc('tx',{...statusQuery,wait_until:'NONE'});
      } catch(statusError) {
        if(!(statusError instanceof RpcQueryError)||statusError.data?.cause?.name!=='UNKNOWN_TRANSACTION')throw statusError;
        // This nonce can no longer execute. Preserve the attempt and keep its
        // gas reservation until actual burn can be independently established.
        this.db.prepare('UPDATE near_nav_reports SET receipt=? WHERE hash=? AND receipt IS NULL')
          .run(canonical({rejected:'invalid-nonce',finalizedAccessKeyNonce:String(key.nonce),checkedAt:this.now()}),hash);
        return false;
      }
      if(receipt.final_execution_status!=='FINAL')
        receipt=await provider.sendJsonRpc('tx',{...statusQuery,wait_until:'FINAL'});
    }
    if(receipt.final_execution_status!=='FINAL')throw new Error('NAV report is awaiting finality.');
    const outcomes=[receipt.transaction_outcome,...receipt.receipts_outcome];
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.db.prepare('SELECT day,receipt FROM near_nav_reports WHERE hash=?').get(hash) as {day:string;receipt:string|null};
      if(!row.receipt){
        const burned=outcomes.reduce((sum,x)=>sum+BigInt(x.outcome.tokens_burnt),0n);
        const budget=this.db.prepare('SELECT spent FROM near_nav_budget WHERE day=?').get(row.day) as {spent:string};
        this.db.prepare('UPDATE near_nav_budget SET spent=? WHERE day=?')
          .run(String(BigInt(budget.spent)-GAS_RESERVATION+burned),row.day);
        this.db.prepare('UPDATE near_nav_reports SET receipt=? WHERE hash=?').run(canonical(receipt),hash);
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(typeof receipt.status!=='object'||!('SuccessValue' in receipt.status)||
       outcomes.some(x=>typeof x.outcome.status==='object'&&'Failure' in x.outcome.status))
      throw new Error('The testnet NAV report failed. A fresh report will retry after the next quote.');
    return true;
  }
}
