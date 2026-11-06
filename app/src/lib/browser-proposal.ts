import { proposalRequest } from '../../../near-demo/model.js';
import type { Quote, Session } from '../../../near-demo/types.js';

/** Never serialize the stored run: it contains its previous prompts and journal. */
export function browserProposalRequest(
  session:Session,market:Quote,
  strategy:{id:string;commitment:string},
  context:Parameters<typeof proposalRequest>[3],
) {
  if(!context)throw new Error('A fresh market context is required before browser inference.');
  if(context.source!==market.source)throw new Error('Market observations do not match the current quote source.');
  if(market.source==='live'&&!market.signatureVerified)throw new Error('A verified live quote is required before browser inference.');
  const request=proposalRequest(session,market,session.agent!.modelId,{
    ...context,strategyVersion:{id:strategy.id,commitment:strategy.commitment},
  });
  const live=market.source==='live';
  request.messages[0].content+=live
    ? ' Market inputs are live 1Click dry-run quotes with verified signatures. Paper mode describes simulated orders and fills. Describe these quotes as live, never as synthetic or fabricated. Use only supplied observations.'
    : ' Market inputs are synthetic replay observations. Describe them as synthetic, never as live market prices.';
  const input=JSON.parse(request.messages[1].content);
  input.marketDataProvenance={source:market.source,signatureVerified:market.signatureVerified,
    quotes:live?'live signed dry-run quotes':'synthetic replay observations',execution:'simulated paper fills'};
  request.messages[1].content=JSON.stringify(input);
  return request;
}
