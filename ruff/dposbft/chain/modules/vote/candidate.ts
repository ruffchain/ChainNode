import { DposViewContext, isValidAddress } from "../../../../../src/core";

export async function funcGetCandidateInfo(context: DposViewContext, params: any): Promise<any> {
  context.logger.info('funcGetCandidateInfo');

  let hret: any = await context.getCandidates();
  if (!hret) {
    context.logger.error('Empty candidates list');
    return {};
  }

  if (!isValidAddress(params.address)) {
    context.logger.error('Wrong address');
    return {};
  }

  context.logger.info(hret);

  for (let i = 0; i < hret.candidates.length; i++) {
    context.logger.info("candidate:" + hret.candidates[i].candidate);
    context.logger.info("address:" + params.address);
    if (hret.candidates[i].candidate === params.address) {
      return hret.candidates[i];
    }
  }
  context.logger.error('Cannot find ', params);
  return {};
}
