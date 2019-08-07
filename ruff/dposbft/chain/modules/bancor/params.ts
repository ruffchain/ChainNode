import { DposViewContext, BigNumber, ErrorCode, Chain } from "../../../../../src/core";
import { bCheckTokenid } from "../scoop";


export async function funcGetBancorTokenParams(context: DposViewContext, params: any): Promise<{ F: BigNumber, S: BigNumber, R: BigNumber, N: BigNumber } | number> {

    // let outputError = { F: new BigNumber(0), S: new BigNumber(0), R: new BigNumber(0) };
    if (!params.tokenid || !bCheckTokenid(params.tokenid)) {
        return ErrorCode.RESULT_WRONG_ARG;
    }
    let tokenIdUpperCase = params.tokenid.toUpperCase();

    // get F
    let kvFactor = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
    if (kvFactor.err) {
        context.logger.error('getbancortokenparams() fail open kvFactor');
        return ErrorCode.RESULT_DB_TABLE_OPEN_FAILED;
    }
    let retFactor = await kvFactor.kv!.get(tokenIdUpperCase);
    if (retFactor.err) {
        return ErrorCode.RESULT_DB_RECORD_EMPTY;
    }
    let Factor = new BigNumber(retFactor.value);

    // get S
    let kvSupply = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
    if (kvSupply.err) {
        context.logger.error('getbancortokenparams() fail open kvSupply');
        return ErrorCode.RESULT_DB_TABLE_OPEN_FAILED;
    }

    let retSupply = await kvSupply.kv!.get(tokenIdUpperCase);
    if (retSupply.err) { return ErrorCode.RESULT_DB_RECORD_EMPTY; }

    let Supply = new BigNumber(retSupply.value);

    // get R
    let kvReserve = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
    if (kvReserve.err) {
        context.logger.error('getbancortokenparams() fail open kvReserve'); return ErrorCode.RESULT_DB_TABLE_OPEN_FAILED;
    }

    let retReserve = await kvReserve.kv!.get(tokenIdUpperCase);
    if (retReserve.err) { return ErrorCode.RESULT_DB_RECORD_EMPTY; }

    let Reserve = new BigNumber(retReserve.value);

    // get N
    let kvNonliquidity = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
    if (kvNonliquidity.err) {
        context.logger.error('getbancortokenparams() fail open kvNonliquidity'); return ErrorCode.RESULT_DB_TABLE_OPEN_FAILED;
    }

    let retNonliquidity = await kvNonliquidity.kv!.get(tokenIdUpperCase);
    if (retNonliquidity.err) { return ErrorCode.RESULT_DB_RECORD_EMPTY; }

    let Nonliquidity = new BigNumber(retNonliquidity.value);

    return { F: Factor, S: Supply, R: Reserve, N: Nonliquidity };
}
