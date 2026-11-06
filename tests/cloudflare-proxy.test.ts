import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyPublicApi } from '../near-demo/cloudflare-proxy.js';
const origin='https://pump-near-893.pages.dev';
const backend='https://pump-public-api-production.up.railway.app';

test('Cloudflare proxy preserves signed public bodies and query parameters without forwarding cookies',async()=>{
  const body='{"batch":{"schema":"fixture"},"signature":"unaltered"}';
  const request=new Request(origin+'/api/pump-directory/journal-publish?offset=2',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json',Cookie:'private-cookie',Authorization:'private-token'},
    body});
  const response=await proxyPublicApi(request,backend,async(input,init)=>{
    assert.equal(String(input),backend+'/api/pump-directory/journal-publish?offset=2');
    const forwarded=new Request(input,init);
    assert.equal(await forwarded.text(),body);
    assert.equal(forwarded.headers.get('Origin'),origin);
    assert.equal(forwarded.headers.get('Cookie'),null);
    assert.equal(forwarded.headers.get('Authorization'),null);
    return Response.json({ok:true},{headers:{'Set-Cookie':'do-not-forward','Retry-After':'60'}});
  });
  assert.deepEqual(await response.json(),{ok:true});
  assert.equal(response.headers.get('Set-Cookie'),null);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('Retry-After'),'60');
});

test('Cloudflare proxy fails closed on private APIs, foreign origins, redirects, and upstream failures',async()=>{
  let calls=0;
  const upstream:typeof fetch=async()=>{calls++;return Response.json({});};
  assert.equal((await proxyPublicApi(new Request(origin+'/api/near-demo/status'),backend,upstream)).status,404);
  assert.equal((await proxyPublicApi(new Request(origin+'/api/pump-directory/journal-publish',{
    method:'POST',headers:{Origin:'https://elsewhere.example'}}),backend,upstream)).status,403);
  assert.equal(calls,0);
  assert.equal((await proxyPublicApi(new Request(origin+'/api/near-demo/public-status'),backend,
    async()=>new Response(null,{status:302,headers:{Location:'https://elsewhere.example'}}))).status,502);
  assert.equal((await proxyPublicApi(new Request(origin+'/api/near-demo/public-status'),backend,
    async()=>{throw new Error('private upstream detail');})).status,502);
});
