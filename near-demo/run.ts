import { createServer } from 'node:http';
import { nearDemoApi } from './api.js';
const api=nearDemoApi();
const port=Number(process.env.PUMPCOIN_DEMO_PORT??5197);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid demo port.');
const server=createServer((req,res)=>{void api.handle(req,res,()=>{res.writeHead(404);res.end('Demo API route not found.');});});
server.listen(port,'127.0.0.1',()=>console.log(`PumpCoin paper demo API at http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{api.close();server.close();});
