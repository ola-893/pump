export function paperAmount(value:string|null|undefined,decimals=6,minimum=2) {
  if(value==null)return '—';
  const number=Number(value)/10**decimals;
  if(number!==0&&Math.abs(number)<1e-12)
    return (number<0?'−':'')+paperAmountInput(value.replace(/^-/,''),decimals);
  return number.toLocaleString(undefined,{
    minimumFractionDigits:Math.min(minimum,decimals),
    maximumFractionDigits:Math.max(Math.min(12,decimals),Math.min(minimum,decimals)),
  });
}

export function paperAmountInput(value:string,decimals:number) {
  const amount=BigInt(value),scale=10n**BigInt(decimals),fraction=amount%scale;
  return String(amount/scale)+(fraction?'.'+String(fraction).padStart(decimals,'0').replace(/0+$/,''):'');
}

export function parsePaperAmount(value:string,decimals:number) {
  if(!/^\d+(?:\.\d+)?$/.test(value))throw new Error('Enter a positive amount in the selected quote currency.');
  const [whole,fraction='']=value.split('.');
  if(fraction.length>decimals)throw new Error(`This quote currency accepts up to ${decimals} decimal places.`);
  const scale=10n**BigInt(decimals);
  const amount=BigInt(whole)*scale+BigInt(fraction.padEnd(decimals,'0')||'0');
  if(!amount||amount>1_000_000n*scale)throw new Error('Enter a positive amount up to one million quote-currency units.');
  return String(amount);
}
