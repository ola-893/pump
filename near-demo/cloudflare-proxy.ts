const jsonError = (status:number, error:string) => Response.json({error},{
  status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
});

/** Only the public API is reachable through the hosted frontend. */
export async function proxyPublicApi(request:Request, apiOrigin:string, fetcher:typeof fetch=fetch) {
  const url=new URL(request.url), origin=request.headers.get('Origin');
  if(origin&&origin!==url.origin)return jsonError(403,'This origin is not allowed.');
  if(!['GET','HEAD','POST','OPTIONS'].includes(request.method))return jsonError(405,'Method not allowed.');
  if(!url.pathname.startsWith('/api/near-demo/public-')&&
     url.pathname!=='/api/pump-directory'&&!url.pathname.startsWith('/api/pump-directory/'))
    return jsonError(404,'Public route unavailable.');
  const backend=new URL(apiOrigin);
  if(backend.protocol!=='https:'||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)
    return jsonError(503,'Public service configuration is unavailable.');
  const headers=new Headers();
  for(const key of ['Content-Type','Accept','Origin']){
    const value=request.headers.get(key);
    if(value)headers.set(key,value);
  }
  const target=new URL(url.pathname+url.search,backend);
  try{
    const response=await fetcher(target,{
      method:request.method,headers,
      body:['GET','HEAD'].includes(request.method)?undefined:request.body,
      redirect:'manual',signal:AbortSignal.timeout(20000),
      // Node's Request implementation needs this for streaming request bodies.
      ...(!['GET','HEAD'].includes(request.method)?{duplex:'half' as const}:{}),
    });
    if(response.status>=300&&response.status<400)return jsonError(502,'Unexpected public service redirect.');
    const safeHeaders=new Headers();
    for(const key of ['Content-Type','Retry-After']){
      const value=response.headers.get(key);
      if(value)safeHeaders.set(key,value);
    }
    safeHeaders.set('Cache-Control','no-store');
    safeHeaders.set('X-Content-Type-Options','nosniff');
    return new Response(response.body,{status:response.status,headers:safeHeaders});
  }catch{return jsonError(502,'The public service is temporarily unavailable. Please try again.');}
}
