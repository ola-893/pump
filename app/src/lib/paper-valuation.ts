export type LastPaperValuation={equity:string;at:string;realized:string;sequence:number;capital?:string};
type ValuationSession={createdAt:string;valuationStale:boolean;portfolio:{equity:string|null;realized:string;markAt:string|null;vaultCapital?:{assets:string}};lastValuation?:LastPaperValuation|null};
/** Display historical quotes without promoting them to a fresh execution price. */
export function paperValuation(session:ValuationSession,initialCash:string){
 const retained=session.portfolio.equity!=null?{equity:session.portfolio.equity,at:session.portfolio.markAt??session.createdAt,realized:session.portfolio.realized,capital:session.portfolio.vaultCapital?.assets}:session.lastValuation;
 if(!retained)return null;
 const total=BigInt(retained.equity)-BigInt(retained.capital??initialCash);
 return {equity:retained.equity,at:retained.at,total:String(total),unrealized:String(total-BigInt(retained.realized)),stale:session.valuationStale};
}
