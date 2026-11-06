import { proposalRequest } from '../../../near-demo/model.js';
import type { Quote, Session } from '../../../near-demo/types.js';

/** Never serialize the stored run: it contains its previous prompts and journal. */
export function browserProposalRequest(
  session:Session,market:Quote,
  strategy:{id:string;commitment:string},
  context:Parameters<typeof proposalRequest>[3],
) {
  if(!context)throw new Error('A fresh market context is required before browser inference.');
  return proposalRequest(session,market,session.agent!.modelId,{
    ...context,strategyVersion:{id:strategy.id,commitment:strategy.commitment},
  });
}
