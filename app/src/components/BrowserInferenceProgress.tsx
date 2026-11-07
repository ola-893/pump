import { useEffect, useState } from 'react';
import type { InferenceProgress } from '../lib/browser-inference-progress';

const stages = {
  scanning: ['Finding your model', 'Checking the model folder you allowed.'],
  verifying: ['Verifying model weights', 'Reading the model file and checking its saved checksum.'],
  loading: ['Loading model into memory', 'Large models can take several minutes. Keep this tab open.'],
  retrying: ['Retrying model load', 'The first load failed. Pump is trying again with less work on the GPU.'],
  quoting: ['Getting live market quotes', 'Requesting signed prices for this strategy.'],
  evaluating: ['Evaluating the market', 'Your model is preparing a decision from the live quotes.'],
  saving: ['Saving the decision', 'Recording the result in this browser’s journal.'],
};

export function BrowserInferenceProgress({progress}:{progress:InferenceProgress}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[]);
  const [title,detail]=stages[progress.stage];
  const seconds=Math.max(0,Math.floor((now-progress.startedAt)/1000));
  const elapsed=seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
  const measured=progress.completedBytes!==undefined&&!!progress.totalBytes;
  const percent=measured?Math.min(100,Math.floor(progress.completedBytes!*100/progress.totalBytes!)):undefined;
  return <section className="nd-notice" aria-label="Decision progress" aria-busy="true">
    <strong>{title}</strong>
    <p>{detail}</p>
    <progress aria-label={title} max={100} value={percent}/>
    {measured&&<span> {percent}% · {(progress.completedBytes!/1e9).toFixed(2)} / {(progress.totalBytes!/1e9).toFixed(2)} GB</span>}
    <p>Elapsed {elapsed}</p>
  </section>;
}
