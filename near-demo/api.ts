import {DirectoryNavSource} from './directory/nav-source.js';
import {directoryHandler} from './directory/server.js';
import {publishedVaults} from './directory/read-model.js';
import {PumpDirectory} from './directory/service.js';
import {DirectoryRunner} from './directory/runner.js';
import { randomBytes } from 'node:crypto';
import { investorPerformance } from '../app/src/lib/agent-performance.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { allowedRequest } from './local-origin.js';
import { PaperDemo } from './service.js';
import { DemoStore } from './store.js';
import { TestnetDemo, type TestnetConfig } from './testnet.js';
import { testAccount } from './types.js';
import { ContinuousTrading } from './continuous.js';
import { NearAgents } from './agents.js';
import { AgentVaults,type VaultConfig } from './agent-vaults.js';
import { LiveVaultNav } from './live-vault-nav.js';
import { StrategyDeployment } from './strategy-deployment.js';
import {StrategyVaultUpgrade} from './strategy-vault-upgrade.js';
import {vaultReadiness} from './vault-readiness.js';
const PREFIX='/api/near-demo';
export function nearDemoApi(options:{paper?:PaperDemo;testnet?:TestnetDemo;vaultConfig?:VaultConfig;vaultFetcher?:typeof fetch;directoryKeyPermission?:(account:string,key:string)=>Promise<string>}={}){
  const paper=options.paper??new PaperDemo(new DemoStore(fileURLToPath(new URL('../.local/near-demo/paper.sqlite',import.meta.url))));
  const testnet=options.testnet??new TestnetDemo(JSON.parse(readFileSync(new URL('../deployments/near-demo-testnet.json',import.meta.url),'utf8')) as TestnetConfig);
  const agents=new NearAgents(paper);
  const continuous=new ContinuousTrading(agents);
  const vaults=new AgentVaults(agents,testnet,options.vaultConfig,options.vaultFetcher);
  const strategyDeployment=new StrategyDeployment(vaults);
  const vaultUpgrade=new StrategyVaultUpgrade(vaults);
  const directory=new PumpDirectory(paper.store.db,process.env.PUMP_DIRECTORY_ORIGIN??'http://127.0.0.1:5197',options.directoryKeyPermission);
  const directoryRunner=new DirectoryRunner(agents,vaults,directory);
  const navSources=new DirectoryNavSource(vaults,directoryRunner);
  const liveNav=new LiveVaultNav(navSources.facade);
  const sharedHandler=directoryHandler(directory,new Set((process.env.PUMP_DIRECTORY_CLIENT_ORIGINS??'http://127.0.0.1:5197').split(',')));
  const token=randomBytes(32).toString('hex');
  async function externalCatalog(){
    const catalog=await directoryRunner.catalog();
    const agentIds=new Set(agents.records().map(agent=>agent.id));
    const runIds=new Set(agents.strategies.records().map(run=>run.id));
    const sessionIds=new Set(paper.store.list().map(session=>session.id));
    return catalog.filter(({entry})=>!agentIds.has(entry.agent.id)&&!sessionIds.has(entry.agent.sessionId)&&
      !entry.runs.some((run:{id:string;sessionId:string})=>runIds.has(run.id)||sessionIds.has(run.sessionId)));
  }
  const send=(res:ServerResponse,code:number,body:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  async function handle(req:IncomingMessage,res:ServerResponse,next:()=>void){
    if(req.url?.startsWith('/api/pump-directory/')){const original=req.url;req.url=req.url.slice('/api/pump-directory'.length);try{await sharedHandler(req,res);}finally{req.url=original;}return;}
    if(!req.url?.startsWith(PREFIX)){next();return;}
    if(!allowedRequest(req)){send(res,403,{error:'Demo controls accept only this loopback application origin.'});return;}
    if(req.url===PREFIX+'/public-status'&&req.method==='GET'){const registry=agents.publicStatus();let directoryError='';let external:any[]=[];try{external=await externalCatalog();}catch{directoryError='Shared directory unavailable; local public agents shown.';}
      registry.agents.push(...external.map(x=>({...x.entry.agent,directoryProof:x.proof,runnerOffline:x.offline})));
      registry.strategyRuns.push(...external.flatMap(x=>x.entry.runs.map((r:any)=>({...r,session:{...r.session,state:x.offline?'stopped':r.session.state,valuationStale:x.offline||r.session.portfolio.position!=='0'&&(!r.session.portfolio.markAt||Date.now()-Date.parse(r.session.portfolio.markAt)>30000)}}))));
      const ids=new Set(registry.agents.map(a=>a.id));send(res,200,{mode:'public-paper-catalog',mainnetTrading:false,registry:{...registry,directoryError,liveNavErrors:liveNav.status().filter(x=>registry.strategyRuns.some(r=>r.id===x.runId)),vaults:[...vaults.list().filter(v=>ids.has(v.agentId)),...external.flatMap(x=>x.entry.vaults)]}});return;}
    const publicPaths=new Set(['/nav-evidence','/strategy-report','/strategy-history','/history','/vault-state','/vault-plan','/vault-receipt']);
    const publicRequest=req.url.startsWith(PREFIX+'/public-'),requestedPath=publicRequest?'/'+req.url.slice((PREFIX+'/public-').length):req.url.slice(PREFIX.length);
    if(req.url===PREFIX+'/status'&&req.method==='GET'){send(res,200,{token,sessions:paper.list(),testnet:testnet.config,mode:'paper-with-optional-testnet-clearing',mainnetTrading:false,registry:{...agents.status(),directory:directoryRunner.status(),liveNavErrors:liveNav.status(),vaults:vaults.list(),pendingStrategyAgents:strategyDeployment.pending(),vaultFactoryReady:vaults.config().factory?.liveNav===true,continuous:continuous.status()}});return;}
    if(req.method!=='POST'||req.headers['content-type']?.split(';')[0]!=='application/json'||(publicRequest?!publicPaths.has(requestedPath):req.headers['x-pumpcoin-demo-token']!==token)){send(res,403,{error:'Refresh to establish a local demo session.'});return;}
    try {
      const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw new Error('Demo request too large.');chunks.push(Buffer.from(chunk));}
      const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!b||typeof b!=='object'||Array.isArray(b))throw new Error('Invalid request.');
      const path=requestedPath;const fields:Record<string,string[]>={ '/nav-evidence':['runId'], '/directory-challenge':['account','action'],'/directory-authorize':['id','signed'], '/create':['config'],'/view':['id'],'/history':['id'],'/export':['id'],'/cycle':['id'],'/start':['id'],'/stop':['id'],'/mark':['id'],'/scenario':['id','action','quoteUnits'],'/testnet-state':['account'],'/testnet-plan':['action','account','amount','id'],'/testnet-receipt':['hash','account'],'/testnet-link':['id','account'],'/models':[],'/register-agent':['registration'],'/classifier-check':['agentId'],'/agent-visibility':['agentId','visibility','expectedVisibility'],'/agent-export':['agentId'],'/compare':['agentIds'],'/stop-comparison':[],'/market-history':[],'/intent-assets':[],'/intent-market-check':['market','amount','slippageBps'],'/start-live':['agentIds'],'/stop-live':[],'/execution-exercise':['agentIds'],'/start-continuous':['agentIds'],'/stop-continuous':[],'/strategy-save':['agentId','expectedVersion','settings','account'],'/strategy-deployment':['agentId'],'/strategy-publish-plan':['agentId','account'],'/demo-readiness':[],'/vault-upgrade':['runId','account'],'/strategy-exit':['runId','expectedPosition','lastFillHash'],'/strategy-action':['runId','action'],'/strategy-report':['runId'],'/strategy-history':['runId'],'/strategy-export':['runId'],'/vault-state':['agentId','runId','account'],'/vault-plan':['agentId','action','account','amount','runId'],'/vault-receipt':['agentId','runId','account','hash'],'/vault-start':['agentId','runId'],'/vault-stop':['agentId','runId'] };
      if(!fields[path]||Object.keys(b).sort().join()!==fields[path].slice().sort().join())throw new Error('Unsupported demo action or fields.');
      if(path!=='/directory-authorize'&&fields[path].includes('id')&&b.id!==''&&!/^[a-f0-9-]{36}$/.test(b.id))throw new Error('Invalid session ID.');
      if(publicRequest){
        const local=agents.records(),known=path==='/history'?local.some(a=>a.sessionId===b.id)||agents.strategies.records().some(r=>r.sessionId===b.id):
          path==='/nav-evidence'||path==='/strategy-report'||path==='/strategy-history'?agents.strategies.records().some(r=>r.id===b.runId):local.some(a=>a.id===b.agentId);
        if(!known){
          const catalog=await externalCatalog(),source=catalog.find(x=>x.entry.agent.id===b.agentId||x.entry.agent.sessionId===b.id||x.entry.runs.some((r:any)=>r.id===b.runId||r.sessionId===b.id));
          if(!source)throw new Error('Public agent unavailable.');
          const {entry}=await directoryRunner.read(source.entry.agent.id);let result;
          const run=entry.runs.find((r:any)=>r.id===b.runId||r.sessionId===b.id),history=run?entry.histories[run.id]:null;
          if(path==='/nav-evidence')result={evidence:liveNav.evidence(b.runId)};
          else if(path==='/strategy-history'||path==='/history'){if(!history)throw new Error('This earlier local journal has not been published. Inspect a saved strategy journal instead.');result={events:history.events};}
          else if(path==='/strategy-report'){if(!history)throw new Error('Strategy journal unavailable.');result={report:investorPerformance(history.session,history.events)};}
          else {
            const remote=publishedVaults(entry,agents,testnet,vaults.config());
            if(path==='/vault-state')result={observation:await remote.inspect(b.agentId,b.runId,b.account)};
            else if(path==='/vault-plan'){if(!['prepare','deposit','redeem','withdraw','cancel-expired'].includes(b.action))throw new Error('Owner action requires the operator’s local workspace.');result={plans:await remote.plan(b.agentId,b.action,b.account,b.amount,b.runId)};}
            else if(path==='/vault-receipt')result=await remote.receipt(b.agentId,b.runId,b.account,b.hash);
            else throw new Error('Public operation unavailable.');
          }
          send(res,200,result);return;
        }
        if(path==='/nav-evidence'||path==='/strategy-history'||path==='/strategy-report'){let agentId:string;try{agentId=agents.strategies.read(b.runId).agentId;}catch{throw new Error('Agent record unavailable.');}agents.assertPublic(agentId);}
        else if(path==='/history')agents.assertPublicSession(b.id);
        else {agents.assertPublic(b.agentId);if(path==='/vault-plan'&&!['prepare','deposit','redeem','withdraw','cancel-expired'].includes(b.action))throw new Error('This action is available only in the local owner workspace.');}
      }
      let result:unknown;
      if(path==='/nav-evidence')result={evidence:liveNav.evidence(b.runId)};
      if(path==='/directory-challenge')result=await directoryRunner.challenge(b.account,b.action);
      if(path==='/directory-authorize')result=await directoryRunner.authorize(b.id,b.signed);
      if(path==='/classifier-check')result=await agents.checkModel(b.agentId);
      if(path==='/agent-visibility'){
        if(strategyDeployment.pending().includes(b.agentId))throw new Error('Finish the pending strategy vault before changing visibility.');
        if(b.visibility==='public'){
          const a=agents.read(b.agentId);
          if(agents.visibility(a)==='private'&&await strategyDeployment.publicationPlan(b.agentId,a.manifest.controller))
            throw new Error('Approve opening the strategy vault in the owner wallet first.');
        }
        result={agent:vaults.setVisibility(b.agentId,b.visibility,b.expectedVisibility)};
      }
      if(path==='/vault-state')result={observation:{...await vaults.inspect(b.agentId,b.runId,b.account),reportingError:liveNav.status().find(x=>x.runId===b.runId)?.error??null}};
      if(path==='/vault-plan')result=await liveNav.investorPlan(vaults,b.agentId,b.action,b.account,b.amount,b.runId);
      if(path==='/vault-receipt')result=await vaults.receipt(b.agentId,b.runId,b.account,b.hash);
      if(path==='/vault-start')result=await vaults.startRound(b.agentId,b.runId);
      if(path==='/vault-stop')result=await vaults.stopRound(b.agentId,b.runId);
      if(path==='/intent-assets')result=await strategyDeployment.markets.catalog();
      if(path==='/intent-market-check')result=await strategyDeployment.markets.check(b.market,b.amount,b.slippageBps);
      if(path==='/strategy-save')result=await strategyDeployment.prepare(b.agentId,b.expectedVersion,b.settings,b.account);
      if(path==='/strategy-deployment')result=await strategyDeployment.step(b.agentId);
      if(path==='/strategy-publish-plan')result={plan:await strategyDeployment.publicationPlan(b.agentId,b.account)};
      if(path==='/demo-readiness')result=await vaultReadiness(vaults,liveNav.status());
      if(path==='/vault-upgrade')result=await vaultUpgrade.step(b.runId,b.account);
      if(path==='/strategy-exit')result=await agents.strategies.operatorExit(b.runId,b.expectedPosition,b.lastFillHash);
      if(path==='/strategy-action')result=await agents.strategies.action(b.runId,b.action);
      if(path==='/strategy-report'){const bundle=agents.strategies.export(b.runId);result={report:investorPerformance(bundle.paper.session,bundle.paper.events)};}
      if(path==='/strategy-history')result={events:agents.strategies.history(b.runId)};
      if(path==='/strategy-export')result={bundle:agents.strategies.export(b.runId)};
      if(path==='/start-continuous')result={continuous:continuous.start(b.agentIds)};
      if(path==='/stop-continuous')result={continuous:continuous.stop()};
      if(continuous.status()?.enabled&&['/cycle','/scenario','/start','/start-live','/execution-exercise','/compare'].includes(path))throw new Error('Stop continuous paper trading before running another worker or comparison.');
      if(path==='/execution-exercise')result={agents:await agents.requestExercise(b.agentIds)};
      if(path==='/start-live')result={sessions:agents.startLive(b.agentIds)};
      if(path==='/stop-live'){continuous.stop();result=agents.stopLive();}
      if(path==='/models')result={models:await agents.inventory.scan()};
      if(path==='/register-agent')result={agent:await agents.register(b.registration)};
      if(path==='/agent-export')result={bundle:agents.export(b.agentId)};
      if(path==='/stop-comparison')result=agents.stopComparison();
      if(path==='/compare')result={comparison:await agents.compare(b.agentIds)};
      if(path==='/market-history'){const data=await agents.market(true);result={datasetId:data.id,count:data.bars.length};}
      if(path==='/create')result={session:paper.create(b.config)};
      if(path==='/view')result={session:paper.view(paper.store.read(b.id))};
      if(path==='/history')result={events:paper.store.history(b.id)};
      if(path==='/export')result={bundle:paper.store.export(b.id)};
      if(path==='/cycle')result={session:await paper.cycle(b.id)};
      if(path==='/start'){
        const session=paper.store.read(b.id);
        result=session.agent?.strategyRunId?await agents.strategies.action(session.agent.strategyRunId,'start'):{session:paper.start(b.id)};
      }
      if(path==='/stop')result={session:paper.stop(b.id)};
      if(path==='/mark')result={session:await paper.refresh(b.id)};
      if(path==='/scenario'){
        if(!['BUY','SELL'].includes(b.action))throw new Error('Choose BUY or SELL.');
        result={session:await paper.cycle(b.id,{action:b.action,quoteUnits:b.quoteUnits,reason:'User-triggered manual scenario; not an autonomous model decision.'})};
      }
      if(path==='/testnet-state')result={observation:await testnet.inspect(b.account?testAccount(b.account):undefined)};
      if(path==='/testnet-link'){
        const account=testAccount(b.account),state=await testnet.inspect(account);
        if(!state.claim)throw new Error('Confirmed Circle test USDC deposit is required.');
        result={session:await paper.attach(b.id,account,state.claim)};
      }
      if(path==='/testnet-plan')result={plans:await testnet.plan(b.action,testAccount(b.account),b.amount||undefined,b.id||undefined,b.action==='result'?await paper.result(b.id):undefined)};
      if(path==='/testnet-receipt')result=await testnet.receipt(b.hash,testAccount(b.account));
      send(res,200,result);
    }catch(error){const message=error instanceof Error&&error.message.length<300&&!/\/Users\/|\/private\/|password|secret|Bearer/i.test(error.message)?error.message:'Demo operation failed; inspect the local service.';send(res,400,{error:message});}
  }
  return {handle,paper,testnet,agents,continuous,vaults,close(){navSources.close();directoryRunner.close();liveNav.close();continuous.close();paper.close();void agents.close();}};
}
export function nearDemoPlugin(){
  const configure=(server:{middlewares:{use:(f:(req:IncomingMessage,res:ServerResponse,next:()=>void)=>void)=>unknown};httpServer?:{once:(name:string,fn:()=>void)=>unknown}|null})=>{
    const api=nearDemoApi();
    server.httpServer?.once('close',()=>api.close());server.middlewares.use((req,res,next)=>{void api.handle(req,res,next).catch(()=>{if(!res.headersSent){res.writeHead(500);res.end('Demo service unavailable.');}});});
  };
  return {name:'pumpcoin-near-paper-demo',configureServer:configure,configurePreviewServer:configure};
}
