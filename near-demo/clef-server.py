"""Loopback-only, offline, text-only Clef scorer; no generation or signing access."""
import argparse, hashlib, importlib.metadata, json, os, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--bundle',required=True);p.add_argument('--alias',required=True);p.add_argument('--port',type=int,default=8093);args=p.parse_args()
path=Path(args.bundle).resolve().parent
for key in ['HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','HF_HUB_DISABLE_TELEMETRY']: os.environ[key]='1'
sys.dont_write_bytecode=True
sys.path.insert(0,str(path))
import clef_mlx
import mlx.core as mx
mx.set_cache_limit(128*1024*1024)
model=clef_mlx.load(path)
# Force a short genuine decision before reporting ready. No GPU memory-limit overrides.
model.systemone({'model':args.alias,'state':'Local warmup.','questions':{'warmup':{'type':'choice','instructions':'Select the state type.','criteria':{'warmup':'The state says local warmup.','other':'The state describes a trade.'}}}},max_length=4096,truncate=False)
health={'status':'ok','model':args.alias,'runtime':'clef-mlx','path':str(path),'context':4096,'truncation':False,'network':'offline','loaderSHA256':hashlib.sha256((path/'clef_mlx.py').read_bytes()).hexdigest(),'serverSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'packages':{n:importlib.metadata.version(n) for n in ['mlx','mlx-lm','mlx-vlm']}}
class Handler(BaseHTTPRequestHandler):
 def send(self,status,body):
  data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
 def do_GET(self):
  if self.path=='/health': self.send(200,health)
  elif self.path=='/v1/models': self.send(200,{'data':[{'id':args.alias}]})
  else: self.send(404,{'error':'Unknown local classifier route'})
 def do_POST(self):
  if self.path!='/v1/systemone': return self.send(404,{'error':'Use fixed-choice scoring'})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if n<1 or n>65536: return self.send(413,{'error':'Classifier request too large'})
   req=json.loads(self.rfile.read(n))
   if set(req)!=set(['model','state','questions','truncate']) or req['model']!=args.alias or req['truncate'] is not False or set(req['questions'])!={'action'}: raise ValueError('Invalid classifier request')
   q=req['questions']['action']
   if q.get('type')!='choice' or len(q.get('criteria',{}))!=2: raise ValueError('Exactly two action options required')
   start=time.perf_counter();out=model.systemone(req,max_length=4096,truncate=False);out['usage']['latency_ms']=round((time.perf_counter()-start)*1000,2);out['usage']['peak_memory_bytes']=mx.get_peak_memory();self.send(200,out);mx.clear_cache()
  except clef_mlx.ContextTooLong: self.send(413,{'error':'Classifier input exceeds 4096 tokens; no truncation or trade assumed'})
  except Exception as e:
   print(type(e).__name__+': '+str(e),file=sys.stderr,flush=True);self.send(400,{'error':'Local classifier request failed; no trade assumed'})
 def log_message(self,*a): pass
print(json.dumps({'ready':health}),flush=True)
HTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
