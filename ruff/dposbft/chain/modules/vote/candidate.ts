import { DposViewContext, isValidAddress } from "../../../../../src/core";

export async function funcGetCandidateInfo(context: DposViewContext, params: any): Promise<any> {
  let hret: any[] = await context.getCandidates();
  if (!hret) {
    context.logger.error('Empty candidates list');
    return {};
  }

  if (!isValidAddress(params.address)) {
    context.logger.error('Wrong address');
    return {};
  }

  for (let i = 0; i < hret.length; i++) {
    if (hret[i].candidate.substr(1) === params.address) {
      return hret[i];
    }
  }
  context.logger.error('Cannot find ', params);
  return {};
}
