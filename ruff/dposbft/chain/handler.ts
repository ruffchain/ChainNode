import { ErrorCode, BigNumber, DposViewContext, DposTransactionContext, ValueHandler, IReadableKeyValue, MapToObject, Chain, isValidAddress } from '../../../src/host';
// import { retarget } from '../../../src/core/pow_chain/consensus';
import { createScript, Script } from 'ruff-vm';
import * as fs from 'fs';
import { SYS_TOKEN_PRECISION, strAmountPrecision, bCheckTokenid, BANCOR_TOKEN_PRECISION, bCheckTokenPrecision, MAX_QUERY_NUM, bCheckDBName, SYS_MORTGAGE_PRECISION, IfRegisterOption, bCheckRegisterOption, isANumber, IfBancorTokenItem } from './modules/scoop';


export interface IfConfigGlobal {
    handler: string;
    type: {
        consensus: string;
        features: any[]
    };

    global: {
        minCreateor: number;
        maxCreateor: number;
        reSelectionBlocks: number;
        blockInterval: number;
        timeOffsetToLastBlock: number;
        timeBan: number;
        unbanBlocks: number;
        dposVoteMaxProducers: number;
        maxBlockIntervalOffset: number;
        depositAmount: number;
        depositPeriod: number;
        mortgagePeriod: number;
    };
}
// Added by Yang Jun 2019-3-27
let configBuffer = fs.readFileSync('./dist/blockchain-sdk/ruff/dposbft/chain/config.json');
let configObj: IfConfigGlobal;
try {
    configObj = JSON.parse(configBuffer.toString())
} catch (e) {
    throw new Error('handler.ts read ./config.json')
}
// Fixed cost for : transferTo, createToken, createBancorToken, transferTokenTo
const SYSTEM_TX_FEE_BN = new BigNumber(0.001);

const DB_NAME_MAX_LEN: number = 12;
const DB_KEY_MAX_LEN: number = 256;
const DB_VALUE_MAX_LEN: number = 512;

////////////////

export function registerHandler(handler: ValueHandler) {
    handler.genesisListener = async (context: DposTransactionContext) => {
        // await context.storage.createKeyValue('bid');
        // await context.storage.createKeyValue('bidInfo');
        await context.storage.createKeyValue('userCode');
        return ErrorCode.RESULT_OK;
    };

    async function getTokenBalance(balanceKv: IReadableKeyValue, address: string): Promise<BigNumber> {
        let retInfo = await balanceKv.get(address);
        return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value : new BigNumber(0);
    }

    async function getAddressCode(codeKv: IReadableKeyValue, address: string): Promise<Buffer | undefined> {
        let retInfo = await codeKv.get(address);
        return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value.code : undefined;
    }

    async function getTableValue(tableKv: IReadableKeyValue, keyName: string): Promise<string | undefined> {
        let retInfo = await tableKv.get(keyName);
        return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value : undefined;
    }
    handler.addTX('setUserCode', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        if (!params.userCode) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        let kvRet = await context.storage.getReadWritableKeyValue('userCode');
        if (kvRet.err) {
            return kvRet.err;
        }

        kvRet = await kvRet.kv!.set(context.caller, { code: params.userCode });
        if (kvRet.err) {
            return kvRet.err;
        }

        return ErrorCode.RESULT_OK;
    });

    handler.addViewMethod('getUserCode', async (context: DposViewContext, params: any): Promise<Buffer | undefined> => {
        let kvRet = await context.storage.getReadableKeyValue('userCode');

        if (kvRet.err) {
            return undefined;
        }

        if (!isValidAddress(params.address)) {
            return undefined;
        }

        return await getAddressCode(kvRet.kv!, params.address);
    });

    handler.addViewMethod('getUserTableValue', async (context: DposViewContext, params: any): Promise<string | undefined> => {
        let contractAddr = params.contractAddr;
        let tableName = params.tableName;
        let keyName = params.keyName;

        if (!isValidAddress(contractAddr)) {
            return undefined;
        }

        if (!bCheckDBName(tableName)) {
            return undefined;
        }

        if (keyName.length > DB_KEY_MAX_LEN) {
            return undefined;
        }

        const dbName = `${contractAddr}-${tableName}`;
        const kvRet = await context
            .storage
            .getReadableKeyValue(dbName);

        if (kvRet.err) {
            return undefined;
        }

        let retInfo = await kvRet.kv!.get(keyName);

        return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value : undefined;

    });

    handler.addTX('runUserMethod', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        let kvRet = await context.storage.getReadableKeyValue('userCode');

        if (kvRet.err) {
            return kvRet.err;
        }
        // Added by Yang Jun 2019-3-29
        if (!isValidAddress(params.to)) {
            return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
        }
        let rawCode = await getAddressCode(kvRet.kv!, params.to);
        if (!rawCode) {
            return ErrorCode.RESULT_NOT_FOUND;
        }

        let code = rawCode.toString();
        const totalValue = context.value;
        const receiver = params.to;
        let usedValue = new BigNumber(0);

        const sandbox = {
            bcLog: (resolve: any, arg0: string, arg1: string) => {
                // console.log(arg0, arg1);
            },

            bcTransfer: async (resolve: any, to: string, amount: string): Promise<any> => {
                console.log('in bcTransfer to:', to, ' amount:', amount);
                try {
                    let toValue = new BigNumber(amount);

                    if (toValue.isNaN() || !isValidAddress(to)) {
                        return (resolve(false));
                    }
                    if (usedValue.plus(toValue).isGreaterThan(totalValue)) {
                        console.log('exceed the amount');
                        return (resolve(false));
                    }

                    const ret = await context
                        .transferTo(to, toValue);
                    if (ret === ErrorCode.RESULT_OK) {
                        usedValue = usedValue.plus(toValue);
                        return (resolve(true));
                    } else {
                        console.log('ret is', ret);
                        return (resolve(false));
                    }
                } catch (err) {
                    console.log('err when transfer', err);
                    resolve(false);
                }
            },
            bcDBCreate: async (resolve: any, name: string): Promise<any> => {
                try {

                    if (!bCheckDBName(name)) {
                        return (resolve(false));
                    }

                    const dbName = `${receiver}-${name}`;

                    const kvRet1 = await context
                        .storage
                        .createKeyValue(dbName);
                    if (kvRet1.err) {
                        return (resolve(false));
                    } else {
                        return (resolve(true));
                    }
                } catch (err) {
                    console.log('error when DB create', err);
                    resolve(false);
                }
            },
            bcDBSet: async (resolve: any, name: string, key: string, value: string): Promise<any> => {

                try {
                    if (!bCheckDBName(name)) {
                        return (resolve(false));
                    }

                    if (key.length > DB_KEY_MAX_LEN || value.length > DB_VALUE_MAX_LEN) {
                        console.log('Invalid input for bcDBSet');
                        return (resolve(false));
                    }

                    let dbName = `${receiver}-${name}`;

                    const kvRet2 = await context
                        .storage
                        .getReadWritableKeyValue(dbName);

                    if (kvRet2.err) {
                        return (resolve(false));
                    } else {
                        let ret = await kvRet2.kv!.set(key, value);
                        if (ret.err) {
                            return (resolve(false));
                        } else {
                            return (resolve(true));
                        }
                    }
                } catch (err) {
                    console.log('error when DB Set', err);
                    resolve(false);
                }
            },
            bcDBGet: async (resolve: any, name: string, key: string): Promise<any> => {
                let ret;

                try {

                    if (!bCheckDBName(name)) {
                        return (resolve(ret));
                    }

                    if (key.length > DB_KEY_MAX_LEN) {
                        console.log('Invalid input for bcDBSet');
                        return (resolve(ret));
                    }

                    let dbName = `${receiver}-${name}`;

                    const kvRet3 = await context
                        .storage
                        .getReadWritableKeyValue(dbName);

                    if (kvRet3.err) {
                        return (resolve(ret));
                    } else {
                        ret = await getTableValue(kvRet3.kv!, key);
                        return (resolve(ret));
                    }
                } catch (err) {
                    console.log('error when DB Set', err);
                    resolve(ret);
                }
            },
        };

        let actionCode = `
            var contract = new Contract("${receiver}","${context.caller}");
            contract.${params.action}("${params.params}");
        `;
        try {
            await createScript(code)
                .setUserCode(actionCode)
                .setSandbox(sandbox)
                .setOption({ cpuCount: 640, memSizeKB: 200 })
                .runAsync();
            return ErrorCode.RESULT_OK;
        } catch (err) {
            console.log('err is', err);
            return ErrorCode.RESULT_FAILED;
        }
    });

    handler.addTX('createToken', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        context.cost(SYSTEM_TX_FEE_BN);

        // 这里是不是会有一些检查什么的，会让任何人都随便创建Token么?

        // 必须要有tokenid，一条链上tokenid不能重复
        if (!params.tokenid || !bCheckTokenid(params.tokenid)
            || !bCheckTokenPrecision(params.precision)) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        // Change tokenid to UpperCase()
        let kvRet = await context.storage.createKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

        if (kvRet.err) {
            return kvRet.err;
        }

        await kvRet.kv!.set('creator', context.caller);
        await kvRet.kv!.set('type', 'default_token');
        // Added by Yang Jun 2019-4-4
        await kvRet.kv!.set('precision', parseInt(params.precision).toString());

        if (params.preBalances) {
            for (let index = 0; index < params.preBalances.length; index++) {
                // 按照address和amount预先初始化钱数
                let strAmount: string = strAmountPrecision(params.preBalances[index].amount, SYS_TOKEN_PRECISION);

                // check address valid
                if (!isValidAddress(params.preBalances[index].address)) {
                    return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
                }
                await kvRet.kv!.set(params.preBalances[index].address, new BigNumber(strAmount));
            }
        }
        return ErrorCode.RESULT_OK;
    });

    handler.addTX('transferTokenTo', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        // Added by Yang Jun 2019-3-27
        context.cost(SYSTEM_TX_FEE_BN);

        let tokenkv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

        if (tokenkv.err) {
            return tokenkv.err;
        }

        let fromTotal = await getTokenBalance(tokenkv.kv!, context.caller);

        // Added by Yang Jun 2019-3-28
        // if (typeof params.amount !== 'number') {
        //     return ErrorCode.RESULT_INVALID_TYPE;
        // }
        let precision = await tokenkv.kv!.get('precision');

        if (precision.err) {
            context.logger.error('precision not found , transferTokenTo');

            return precision.err;
        }

        let strAmount: string = strAmountPrecision(params.amount, parseInt(precision.value.replace('s', '')));
        let amount = new BigNumber(strAmount);

        if (!isValidAddress(params.to)) {
            return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
        }

        if (fromTotal.lt(amount)) {
            return ErrorCode.RESULT_NOT_ENOUGH;
        }
        await (tokenkv.kv!.set(context.caller, fromTotal.minus(amount)));
        await (tokenkv.kv!.set(params.to, (await getTokenBalance(tokenkv.kv!, params.to)).plus(amount)));
        return ErrorCode.RESULT_OK;
    });


    handler.defineEvent('transfer', { indices: ['from', 'to'] });

    handler.addTX('transferTo', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        // Added by Yang Jun 2019-3-27
        context.cost(SYSTEM_TX_FEE_BN);

        // Added by Yang Jun 2019-3-28
        let val: number = context.value.toNumber();
        let val2: string = val.toFixed(SYS_TOKEN_PRECISION);

        if (!isValidAddress(params.to)) {
            return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
        }

        const err = await context.transferTo(params.to, new BigNumber(val2));

        if (!err) {
            context.emit('transfer', { from: context.caller, to: params.to, value: new BigNumber(val2) });
        }
        return err;
    });

    // Added by Yang Jun 2019-2-21
    // Added by Yang Jun 2019-2-20
    /**
     * context's storage is storage_sqlite/storage.ts SqliteReadWritableDatabase
     */
    handler.addTX('createBancorToken', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        context.cost(SYSTEM_TX_FEE_BN);

        // console.log('Yang-- received createBancorToken');
        console.log(params);

        // 参数检查
        if (!params.tokenid || !bCheckTokenid(params.tokenid)) {
            // console.log('Yang-- quit becasue tokenid')
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        if (!params.preBalances) {
            // console.log('Yang-- quit becasue preBalances')
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        // supply has been incorporated into preBalances
        if (!params.factor) {
            // console.log('Yang-- quit becasue factor')
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        // console.log('Yang-- Before context.storage.createKeyValueWithDbname');
        // console.log('Yang-- ', Chain.dbToken, ' ', params.tokenid);

        // put tokenid to uppercase
        let kvRet = await context.storage.createKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
        if (kvRet.err) {
            console.log('Yang-- Quit for context.storage.createKeyValueWithDbname')
            return kvRet.err;
        }

        let kvCreator = await kvRet.kv!.set('creator', context.caller);

        if (kvCreator.err) {
            return kvCreator.err;
        }
        await kvRet.kv!.set('type', 'bancor_token');

        let amountAll = new BigNumber(0);
        if (params.preBalances) {
            for (let index = 0; index < params.preBalances.length; index++) {
                // 按照address和amount预先初始化钱数
                let strAmount: string = strAmountPrecision(params.preBalances[index].amount, BANCOR_TOKEN_PRECISION);

                // check address
                if (!isValidAddress(params.preBalances[index].address)) {
                    return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
                }

                await kvRet.kv!.set(params.preBalances[index].address, new BigNumber(strAmount));

                amountAll = amountAll.plus(new BigNumber(strAmount));
            }
        }

        // Setting bancor parameters
        // set Factor
        let tokenIdUpperCase = params.tokenid.toUpperCase();

        kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
        if (kvRet.err) {
            return kvRet.err;
        }
        kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(params.factor)); // number type
        if (kvRet.err) {
            return kvRet.err;
        }

        // set Reserve
        kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
        if (kvRet.err) {
            return kvRet.err;
        }
        kvRet = await kvRet.kv!.set(tokenIdUpperCase, context.value);
        if (kvRet.err) {
            return kvRet.err;
        }

        // set Supply
        kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
        if (kvRet.err) {
            return kvRet.err;
        }
        kvRet = await kvRet.kv!.set(tokenIdUpperCase, amountAll);
        if (kvRet.err) {
            return kvRet.err;
        }

        // set Nonliquidity
        kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
        if (kvRet.err) {
            return kvRet.err;
        }

        // Consider to use nonliquidity or not
        // nonliquidity == 0; no limit for supply
        // nonliquidity !== 0, supply < nonliquidity!!
        if (!params.nonliquidity) {
            kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(0));
        } else {
            kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(params.nonliquidity).plus(amountAll));
        }

        if (kvRet.err) {
            return kvRet.err;
        }

        return ErrorCode.RESULT_OK;

    });

    handler.addTX('createLockBancorToken', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        context.cost(SYSTEM_TX_FEE_BN);

        // console.log('Yang-- received createBancorToken');
        console.log(params);

        // 参数检查
        if (!params.tokenid || !bCheckTokenid(params.tokenid)) {
            console.log('Yang-- quit becasue tokenid')
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        if (!params.preBalances) {
            console.log('Yang-- quit becasue preBalances')
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        // supply has been incorporated into preBalances
        if (!params.factor) {
            console.log('Yang-- quit becasue factor')
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        // console.log('Yang-- Before context.storage.createKeyValueWithDbname');
        // console.log('Yang-- ', Chain.dbToken, ' ', params.tokenid);

        // put tokenid to uppercase
        let kvRet = await context.storage.createKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
        if (kvRet.err) {
            console.log('Yang-- Quit for context.storage.createKeyValueWithDbname')
            return kvRet.err;
        }

        let kvCreator = await kvRet.kv!.set('creator', context.caller);

        if (kvCreator.err) {
            return kvCreator.err;
        }
        await kvRet.kv!.set('type', 'lock_bancor_token');

        let amountAll = new BigNumber(0);
        if (params.preBalances) {
            for (let index = 0; index < params.preBalances.length; index++) {
                let item: IfBancorTokenItem = params.preBalances[index] as IfBancorTokenItem;
                console.log('------ :', item);
                // 按照address和amount预先初始化钱数
                if (item.amount === undefined
                    || item.address === undefined
                    || item.lock_amount === undefined
                    || item.time_expiration === undefined) {
                    console.log('undefined found!');
                    return ErrorCode.RESULT_WRONG_ARG;
                }
                if (!isANumber(item.amount)
                    || !isANumber(item.lock_amount)
                    || !isANumber(item.time_expiration)) {
                    console.log('Not a valid number');
                    return ErrorCode.RESULT_WRONG_ARG;
                }
                let strAmount: string = strAmountPrecision(item.amount, BANCOR_TOKEN_PRECISION);

                // check address
                if (!isValidAddress(item.address)) {
                    console.log('Invalid address:', item.address);
                    return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
                }

                let bnAmount = new BigNumber(strAmount);
                console.log('bnAmount:', bnAmount);
                let hret = await kvRet.kv!.hset(item.address, '0', bnAmount);

                if (hret.err) {
                    console.log('set bnAmount fail');
                    return hret.err;
                }

                // 
                let strLockAmount: string = strAmountPrecision(item.lock_amount, BANCOR_TOKEN_PRECISION);
                // 
                let bnLockAmount = new BigNumber(strLockAmount);
                console.log('bnLockAmoutn: ', bnLockAmount);

                if (!bnLockAmount.eq(0)) {
                    let curBlock = context.getCurBlock();
                    console.log('curBlock:', curBlock);
                    if (curBlock.eq(0)) {
                        return ErrorCode.RESULT_DB_RECORD_EMPTY;
                    }
                    let dueBlock: number = curBlock.toNumber() + parseInt(item.time_expiration) * 60 / configObj.global.blockInterval;

                    console.log('dueblock: ', dueBlock);

                    hret = await kvRet.kv!.hset(item.address, dueBlock.toString(), bnLockAmount);

                    if (hret.err) {
                        return hret.err;
                    }
                }

                amountAll = amountAll.plus(bnAmount).plus(bnLockAmount);
            }
        }

        console.log('amountAll:', amountAll);

        // Setting bancor parameters
        // set Factor
        let tokenIdUpperCase = params.tokenid.toUpperCase();

        kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
        if (kvRet.err) {
            return kvRet.err;
        }
        kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(params.factor)); // number type
        if (kvRet.err) {
            return kvRet.err;
        }

        // set Reserve
        kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
        if (kvRet.err) {
            return kvRet.err;
        }
        kvRet = await kvRet.kv!.set(tokenIdUpperCase, context.value);
        if (kvRet.err) {
            return kvRet.err;
        }

        // set Supply
        kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
        if (kvRet.err) {
            return kvRet.err;
        }
        kvRet = await kvRet.kv!.set(tokenIdUpperCase, amountAll);
        if (kvRet.err) {
            return kvRet.err;
        }

        // set Nonliquidity
        kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
        if (kvRet.err) {
            return kvRet.err;
        }

        // Consider to use nonliquidity or not
        // nonliquidity == 0; no limit for supply
        // nonliquidity !== 0, supply < nonliquidity!!
        if (!params.nonliquidity) {
            kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(0));
        } else {
            kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(params.nonliquidity).plus(amountAll));
        }

        if (kvRet.err) {
            return kvRet.err;
        }

        return ErrorCode.RESULT_OK;

    });

    // Added by Yang Jun 2019-2-21
    handler.addTX('transferBancorTokenTo', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(SYSTEM_TX_FEE_BN);

        console.log('Yang-- ', params)

        let tokenkv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

        if (tokenkv.err) {
            return tokenkv.err;
        }

        let fromTotal = await getTokenBalance(tokenkv.kv!, context.caller);

        // Added by Yang Jun 2019-3-28
        // if (typeof params.amount !== 'number') {
        //     return ErrorCode.RESULT_INVALID_TYPE;
        // }

        // Added by Yang Jun 2019-3-29
        let strAmount = strAmountPrecision(params.amount, BANCOR_TOKEN_PRECISION);
        let amount = new BigNumber(strAmount);

        if (!isValidAddress(params.to)) {
            return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
        }

        if (fromTotal.lt(amount)) {
            console.log('Yang-- less than amount', amount);
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        let hret = await (tokenkv.kv!.set(context.caller, fromTotal.minus(amount)));
        if (hret.err) { return hret.err; }
        hret = await (tokenkv.kv!.set(params.to, (await getTokenBalance(tokenkv.kv!, params.to)).plus(amount)));
        if (hret.err) { return hret.err; }

        return ErrorCode.RESULT_OK;
    });


    // Added by Yang Jun 2019-2-21
    handler.addTX('transferLockBancorTokenTo', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(SYSTEM_TX_FEE_BN);

        console.log('Yang-- ', params)

        let tokenkv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

        if (tokenkv.err) {
            return tokenkv.err;
        }

        // check token type
        let rtnType = await tokenkv.kv!.get('type');

        console.log(rtnType);

        if (rtnType.err || rtnType.value !== 'lock_bancor_token') {
            console.log('wrong type');
            return ErrorCode.RESULT_NOT_SUPPORT;
        }

        let hret = await tokenkv.kv!.hgetall(context.caller);
        if (hret.err || hret.value!.length === 0) {
            console.log('It is empty');
            return ErrorCode.RESULT_DB_TABLE_FAILED;
        }
        let hret2 = context.getCurBlock();
        if (hret2.eq(0)) {
            return ErrorCode.RESULT_FAILED;
        }
        let curBlock = hret2.toNumber();

        let fromTotal = new BigNumber(0);
        for (let p of hret.value!) {
            console.log('item:')
            console.log(p);
            let dueBlock = p.key;
            let value = p.value;

            if (dueBlock === '0') {
                fromTotal = fromTotal.plus(value);
            } else if (curBlock > parseInt(dueBlock)) {
                fromTotal = fromTotal.plus(value);
                let hret3 = await tokenkv.kv!.hdel(context.caller, dueBlock);
                if (hret3.err) { return hret3.err; }
            }
        }

        // Added by Yang Jun 2019-3-29
        let strAmount = strAmountPrecision(params.amount, BANCOR_TOKEN_PRECISION);
        let amount = new BigNumber(strAmount);

        if (!isValidAddress(params.to)) {
            return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
        }

        if (fromTotal.lt(amount)) {
            console.log('Yang-- less than amount', amount);
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        let hret4 = await (tokenkv.kv!.hset(context.caller, '0', fromTotal.minus(amount)));
        if (hret4.err) { return hret4.err; }

        let hretTo = await tokenkv.kv!.hget(params.to, '0');
        if (hretTo.err === ErrorCode.RESULT_EXCEPTION) { return hretTo.err; }

        let hretTransfer;
        if (hretTo.err === ErrorCode.RESULT_NOT_FOUND) {
            hretTransfer = await tokenkv.kv!.hset(params.to, '0', amount);
        } else {
            hretTransfer = await tokenkv.kv!.hset(params.to, '0', hretTo.value!.plus(amount));
        }

        if (hretTransfer.err) { return hretTransfer.err; }

        return ErrorCode.RESULT_OK;
    });

    // Added by Yang Jun 2019-2-21
    handler.addTX('buyBancorToken', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        context.cost(SYSTEM_TX_FEE_BN);

        console.log('Yang-- buyBancorToken:', params);

        // context.value has the money
        // 参数检查
        if (!params.tokenid) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        let tokenIdUpperCase = params.tokenid.toUpperCase();

        // If context.value lt sys value
        let syskv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbSystem, Chain.kvBalance);
        if (syskv.err) {
            console.log('Yang-- not exist balance');
            return syskv.err;
        }
        let fromTotalSys = await getTokenBalance(syskv.kv!, context.caller);

        let strAmount = context.value.toFixed(SYS_TOKEN_PRECISION);
        let amount = new BigNumber(strAmount);

        if (fromTotalSys.lt(amount)) {
            console.log('Yang-- not enough balance');
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        // get F
        let kvFactor = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
        if (kvFactor.err) {
            return kvFactor.err;
        }
        let retFactor = await kvFactor.kv!.get(tokenIdUpperCase);
        if (retFactor.err) {
            return retFactor.err;
        }
        console.log('Yang-- factor:', retFactor.value.toString());
        let F = new BigNumber(retFactor.value);

        // get S
        let kvSupply = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
        if (kvSupply.err) { return kvSupply.err; }

        let retSupply = await kvSupply.kv!.get(tokenIdUpperCase);
        if (retSupply.err) { return retSupply.err; }

        console.log('Yang-- supply:', retSupply.value.toString());
        let S = new BigNumber(retSupply.value);

        // get R
        let kvReserve = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
        if (kvReserve.err) { return kvReserve.err; }

        let retReserve = await kvReserve.kv!.get(tokenIdUpperCase);
        if (retReserve.err) { return retReserve.err; }

        console.log('Yang-- reserve:', retReserve.value.toString());
        let R = new BigNumber(retReserve.value);

        // get nonliquidity
        let kvNonliquidity = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
        if (kvNonliquidity.err) { return kvNonliquidity.err; }

        let retNonliquidity = await kvNonliquidity.kv!.get(tokenIdUpperCase);
        if (retNonliquidity.err) { return retNonliquidity.err; }

        let N = new BigNumber(retNonliquidity.value);

        // do computation
        let e = new BigNumber(context.value);
        let out: BigNumber;

        out = e.dividedBy(R);
        out = out.plus(new BigNumber(1.0));
        let temp1 = out.toNumber();
        console.log('temp1:', temp1);
        console.log('F:', F.toNumber());
        console.log('math.pow:', Math.pow(temp1, F.toNumber()));

        out = new BigNumber(Math.pow(temp1, F.toNumber()));

        out = out.minus(new BigNumber(1));
        out = out.multipliedBy(S);

        console.log('Yang-- supply plus:', out.toString());
        console.log('Yang-- reserve plus:', e.toString());

        // Update system R,S; Update User account
        R = R.plus(e);
        S = S.plus(out);

        // Yang Jun 2019-3-15, Nonliquiidty is not zero, S > N
        if ((!N.isZero()) && S.gt(N)) {
            return ErrorCode.BANCOR_TOTAL_SUPPLY_LIMIT;
        }

        let kvRet = await kvReserve.kv!.set(tokenIdUpperCase, R);
        if (kvRet.err) {
            console.log('Yang-- update reserve failed')
            return kvRet.err;
        }

        kvRet = await kvSupply.kv!.set(tokenIdUpperCase, S);
        if (kvRet.err) {
            console.log('Yang-- update supply failed')
            return kvRet.err;
        }

        // Update User account
        let kvToken = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, tokenIdUpperCase);
        if (kvToken.err) {
            console.log('Yang-- update user account failed')
            return kvToken.err;
        }

        let fromTotal = await getTokenBalance(kvToken.kv!, context.caller);
        let retToken = await kvToken.kv!.set(context.caller, fromTotal.plus(out));
        if (retToken.err) { return retToken.err; }

        return ErrorCode.RESULT_OK;
    });

    // Added by Yang Jun 2019-2-21
    handler.addTX('sellBancorToken', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        context.cost(SYSTEM_TX_FEE_BN);

        console.log('Yang-- params:', params);

        // 参数检查
        if (!params.tokenid) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        let tokenIdUpperCase = params.tokenid.toUpperCase();

        // get F
        let kvFactor = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
        if (kvFactor.err) {
            return kvFactor.err;
        }
        let retFactor = await kvFactor.kv!.get(tokenIdUpperCase);
        if (retFactor.err) {
            return retFactor.err;
        }
        let F = new BigNumber(retFactor.value);
        console.log('F: ', F.toString());

        // get S
        let kvSupply = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
        if (kvSupply.err) { return kvSupply.err; }

        let retSupply = await kvSupply.kv!.get(tokenIdUpperCase);
        if (retSupply.err) { return retSupply.err; }

        let S = new BigNumber(retSupply.value);
        console.log('S:', S.toString());

        // get R
        let kvReserve = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
        if (kvReserve.err) { return kvReserve.err; }

        let retReserve = await kvReserve.kv!.get(tokenIdUpperCase);
        if (retReserve.err) { return retReserve.err; }

        let R = new BigNumber(retReserve.value);
        console.log('Yang-- R:', R.toString());

        // do computation
        let strAmount = strAmountPrecision(params.amount, BANCOR_TOKEN_PRECISION);
        let e = new BigNumber(strAmount);
        let out: BigNumber;

        // Dont know if it will happen ever
        if (S.lt(e)) {
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        out = e.dividedBy(S);
        out = new BigNumber(1).minus(out);
        let temp1 = out.toNumber();
        out = new BigNumber(Math.pow(temp1, 1 / F.toNumber()));
        out = new BigNumber(1).minus(out);
        out = out.multipliedBy(R);

        // Update system R,S;
        R = R.minus(out);
        S = S.minus(e);

        console.log('Yang-- reserve minus:', out.toString());
        console.log('Yang-- supply minus:', e.toString());

        let kvRet = await kvReserve.kv!.set(tokenIdUpperCase, R);
        if (kvRet.err) { return kvRet.err; }

        kvRet = await kvSupply.kv!.set(tokenIdUpperCase, S);
        if (kvRet.err) { return kvRet.err; }

        // Update User account
        let kvToken = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, tokenIdUpperCase);
        if (kvToken.err) { return kvToken.err; }

        let fromTotal = await getTokenBalance(kvToken.kv!, context.caller);
        if (fromTotal.lt(new BigNumber(params.amount))) {
            console.log('Yang- less than token account');
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        let retToken = await kvToken.kv!.set(context.caller, fromTotal.minus(new BigNumber(params.amount)));
        if (retToken.err) { return retToken.err; }

        // Update User's SYS account, directly change account?
        const err = await context.transferTo(context.caller, out);
        if (!err) {
            context.emit('transfer', { from: '0', to: context.caller, value: out });
        } else {
            return err;
        }

        return ErrorCode.RESULT_OK;
    });

    handler.addViewMethod('getTokenBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
        return await getTokenBalance(balancekv.kv!, params.address);
    });

    handler.addViewMethod('getBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        return await context.getBalance(params.address);
    });

    handler.addViewMethod('getVote', async (context: DposViewContext, params: any): Promise<any> => {
        let v: Map<string, BigNumber> = await context.getVote();
        return MapToObject(v);
    });
    // Added by Yang Jun 2019-5-22
    handler.addViewMethod('getTicket', async (context: DposViewContext, params: any): Promise<any> => {
        let v: any = await context.getTicket(params);
        return v;
    });

    handler.addViewMethod('getStake', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        return await context.getStake(params.address);
    });
    // api_getcandidates
    handler.addViewMethod('getCandidates', async (context: DposViewContext, params: any): Promise<any> => {
        return await context.getCandidates();
    });

    handler.addViewMethod('getMiners', async (context: DposViewContext, params: any): Promise<string[]> => {
        return await context.getMiners();
    });
    // Added by Yang Jun 2019-2-21
    handler.addViewMethod('getBancorTokenBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
        return await getTokenBalance(balancekv.kv!, params.address);
    });
    // Added by Yang Jun 2019-2-21
    handler.addViewMethod('getLockBancorTokenBalance', async (context: DposViewContext, params: any): Promise<any> => {
        let balancekv = (await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase()));

        if (balancekv.err) {
            return {};
        }

        // check token type
        let rtnType = await balancekv.kv!.get('type');

        console.log(rtnType);

        if (rtnType.err || rtnType.value !== 'lock_bancor_token') {
            console.log('wrong type');
            return {};
        }

        // let dbToken = (await context.storage.getReadableDatabase(Chain.dbToken))
        let hret = await balancekv.kv!.hgetall(params.address);
        if (hret.err || hret.value!.length === 0) {
            console.log('It is empty');
            return {};
        }

        // return await getTokenBalance(balancekv.kv!, params.address);
        let out = Object.create(null);
        let curBlock = context.getCurBlock();

        for (let p of hret.value!) {
            let dueBlock = p.key;
            let value = p.value;

            if (dueBlock === '0') {
                out.amount = value;
            } else {
                out.amountLock = value;
                out.dueBlock = dueBlock;
                out.curBlock = curBlock;
                out.dueTime = 1;
            }
        }

        return out;
    });


    handler.addViewMethod('getBancorTokenFactor', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        if (!params.tokenid) {
            return new BigNumber(0);
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
        return await getTokenBalance(balancekv.kv!, params.tokenid.toUpperCase());
    });

    handler.addViewMethod('getBancorTokenReserve', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        if (!params.tokenid) {
            return new BigNumber(0);
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
        return await getTokenBalance(balancekv.kv!, params.tokenid.toUpperCase());
    });

    handler.addViewMethod('getBancorTokenSupply', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        if (!params.tokenid) {
            return new BigNumber(0);
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
        return await getTokenBalance(balancekv.kv!, params.tokenid.toUpperCase());
    });

    // Add getBancorTokenNonliquidity,
    handler.addViewMethod('getBancorTokenNonliquidity', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        if (!params.tokenid) {
            return new BigNumber(0);
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
        return await getTokenBalance(balancekv.kv!, params.tokenid.toUpperCase());
    });

    // Yang Jun 2019-4-10
    handler.addViewMethod('getBancorTokenParams', async (context: DposViewContext, params: any): Promise<{ F: BigNumber, S: BigNumber, R: BigNumber, N: BigNumber } | number> => {

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
        // console.log('Yang-- R:', R.toString());

        // get N
        let kvNonliquidity = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
        if (kvNonliquidity.err) {
            context.logger.error('getbancortokenparams() fail open kvNonliquidity'); return ErrorCode.RESULT_DB_TABLE_OPEN_FAILED;
        }

        let retNonliquidity = await kvNonliquidity.kv!.get(tokenIdUpperCase);
        if (retNonliquidity.err) { return ErrorCode.RESULT_DB_RECORD_EMPTY; }

        let Nonliquidity = new BigNumber(retNonliquidity.value);

        return { F: Factor, S: Supply, R: Reserve, N: Nonliquidity };
    });

    handler.addViewMethod('getZeroBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        return await context.getBalance('0');
    });

    // Yang Jun 2019-4-9
    // feed back is never an object
    handler.addViewMethod('getBalances', async (context: DposViewContext, params: any): Promise<{ address: string, balance: BigNumber }[]> => {

        if (!params.addresses) {
            return [];
        }

        let obj: any;
        try {
            // context.logger.error('getbalances');
            // console.log(params.addresses);
            // console.log(typeof params.addresses)
            obj = JSON.parse(JSON.stringify(params.addresses));
        } catch (e) {
            context.logger.error('getBalances parsing addresses error', params.addresses);
            return [];
        }
        let resultLst: { address: string, balance: BigNumber }[] = [];

        for (let i = 0; i < obj.length && i <= MAX_QUERY_NUM; i++) {
            if (!isValidAddress(obj[i])) {
                return [];
            }

            let result = await context.getBalance(obj[i]);
            resultLst.push({ address: obj[i], balance: result });
        }

        return resultLst;
    });

    handler.addViewMethod('getTokenBalances', async (context: DposViewContext, params: any): Promise<{ address: string, balance: BigNumber }[]> => {

        if (!params.addresses) {
            return [];
        }

        let obj: any;
        try {
            obj = JSON.parse(JSON.stringify(params.addresses));
        } catch (e) {
            context.logger.error('getTokenBalances parsing addresses error', params.addresses);
            return [];
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
        // return await ;
        let resultLst: { address: string, balance: BigNumber }[] = [];

        for (let i = 0; i < obj.length && i <= MAX_QUERY_NUM; i++) {
            if (!isValidAddress(obj[i])) {
                return [];
            }
            let result = await getTokenBalance(balancekv.kv!, obj[i]);
            resultLst.push({ address: obj[i], balance: result });
        }

        return resultLst;
    });
    handler.addViewMethod('getBancorTokenBalances', async (context: DposViewContext, params: any): Promise<{ address: string, balance: BigNumber }[]> => {

        if (!params.addresses) {
            return [];
        }

        let obj: any;
        try {
            obj = JSON.parse(JSON.stringify(params.addresses));
        } catch (e) {
            context.logger.error('getBancorTokenBalances parsing addresses error', params.addresses);
            return [];
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
        // return await ;
        let resultLst: { address: string, balance: BigNumber }[] = [];

        for (let i = 0; i < obj.length && i <= MAX_QUERY_NUM; i++) {
            if (!isValidAddress(obj[i])) {
                return [];
            }

            let result = await getTokenBalance(balancekv.kv!, obj[i]);
            let strAmount = strAmountPrecision(result.toNumber().toString(), BANCOR_TOKEN_PRECISION);
            let e: BigNumber = new BigNumber(strAmount);
            resultLst.push({ address: obj[i], balance: e });
        }

        return resultLst;
    });
    //////////////////////////////////////////////////////////////

    // api_vote
    handler.addTX('vote', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        // context.cost(SYSTEM_TX_FEE_BN); cost nothing
        let objJson: any;
        try {
            objJson = JSON.parse(JSON.stringify(params));
        } catch (e) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        if (!objJson.length || objJson.length <= 0 || objJson.length > configObj.global.dposVoteMaxProducers) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        return await context.vote(context.caller, params);
    });

    handler.addTX('mortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        console.log('Yang Jun - mortgage, handler.ts');

        // if value is differnt from params
        if (!context.value.eq(new BigNumber(params))) {
            return ErrorCode.RESULT_WRONG_ARG;
        }

        let strAmount = strAmountPrecision(context.value.toString(), SYS_MORTGAGE_PRECISION);

        let bnAmount = new BigNumber(strAmount);

        let balance: BigNumber = await context.getBalance(context.caller);
        if (balance.lt(bnAmount)) {
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        return await context.mortgage(context.caller, bnAmount);
    });

    handler.addTX('unmortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee); no Fee needed for mortgage
        // context.cost(SYSTEM_TX_FEE_BN);
        console.log('Yang Jun - unmortgage, handler.ts');
        let strAmount = strAmountPrecision(params, SYS_MORTGAGE_PRECISION);

        console.log('amount:', strAmount);
        let bnAmount = new BigNumber(strAmount);
        let hret = await context.unmortgage(context.caller, bnAmount);
        if (hret) {
            return hret;
        }
        return context.transferTo(context.caller, bnAmount);
    });
    // api_register
    handler.addTX('register', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        context.cost(SYSTEM_TX_FEE_BN);
        let bnThreshold = new BigNumber(configObj.global.depositAmount);
        if (!context.value.eq(bnThreshold)) {
            return ErrorCode.RESULT_NOT_ENOUGH;
        }
        let paramsNew: any;
        try {
            paramsNew = JSON.parse(JSON.stringify(params));
        } catch (e) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        if (!bCheckRegisterOption(paramsNew)) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        return await context.register(context.caller, paramsNew as IfRegisterOption);
    });
    handler.addTX('unregister', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // context.cost(context.fee);
        context.cost(SYSTEM_TX_FEE_BN);
        if (params !== context.caller) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        const ret = await context
            .transferTo(context.caller, new BigNumber(configObj.global.depositAmount));

        if (ret) {
            console.log('unregister , transferTo failed');
            return ret;
        }

        return await context.unregister(context.caller);
    });

    // 拍卖
    // handler.addTX('publish', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
    //     context.cost(context.fee);
    //     // params.name: 发布的name, name不能相同
    //     // context.value: 最低出价, BigNumber
    //     // params.duation: 持续时间，单位是block

    //     // 暂时没有对发布方有value的要求，可以加上发布方要扣除一定数量币的功能
    //     if (isNullOrUndefined(params.name) || !params.duation || params.duation <= 0 || !(params.lowest instanceof BigNumber)) {
    //         return ErrorCode.RESULT_INVALID_PARAM;
    //     }

    //     let bidKV = (await context.storage.getReadWritableKeyValue('bid')).kv!;
    //     let ret = await bidKV.get(params.name);
    //     if (ret.err === ErrorCode.RESULT_OK) {
    //         return ErrorCode.RESULT_ALREADY_EXIST;
    //     }
    //     let bidInfoKV = (await context.storage.getReadWritableKeyValue('bidInfo')).kv!;
    //     await bidInfoKV.hset('biding', params.name, { publisher: context.caller, finish: context.height + params.duation });
    //     await bidKV.set(params.name, { caller: context.caller, value: context.value });
    //     await bidKV.rpush((context.height + params.duation).toString(), params.name);
    //     return ErrorCode.RESULT_OK;
    // });

    // 出价
    // handler.addTX('bid', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
    //     context.cost(context.fee);
    //     // params.name: 发布的name, name不能相同
    //     // context.value: 最低出价, BigNumber
    //     let bidKV = (await context.storage.getReadWritableKeyValue('bid')).kv!;
    //     let ret = await bidKV.get(params.name);
    //     if (ret.err !== ErrorCode.RESULT_OK) {
    //         return ret.err;
    //     }
    //     // 如果本次出价不高于上次，则无效
    //     if ((ret.value!.value as BigNumber).gte(new BigNumber(context.value))) {
    //         return ErrorCode.RESULT_NOT_ENOUGH;
    //     }
    //     // 把上一次的出价还给出价者
    //     await context.transferTo(ret.value!.caller, ret.value!.value);
    //     // 更新新的出价
    //     await bidKV.set(params.name, { caller: context.caller, value: context.value });
    //     return ErrorCode.RESULT_OK;
    // });

    // 在块后事件中处理拍卖结果
    // handler.addPostBlockListener(async (height: number): Promise<boolean> => true,
    //     async (context: DposEventContext): Promise<ErrorCode> => {
    //         context.logger.info(`on BlockHeight ${context.height}`);
    //         let bidKV = (await context.storage.getReadWritableKeyValue('bid')).kv!;
    //         let bidInfoKV = (await context.storage.getReadWritableKeyValue('bidInfo')).kv!;
    //         do {
    //             let ret = await bidKV.rpop(context.height.toString());
    //             if (ret.err === ErrorCode.RESULT_OK) {
    //                 const name = ret.value;
    //                 let info = (await bidInfoKV.hget('biding', name)).value!;
    //                 const lastBid = (await bidKV.get(name)).value;
    //                 if (lastBid.caller !== info.publisher) {    //  否则流标
    //                     await context.transferTo(info.publisher, lastBid.value);
    //                     // 存储本次拍卖的结果
    //                     info.owner = lastBid.caller;
    //                     info.value = lastBid.value;
    //                 }
    //                 await bidInfoKV.hdel('biding', name);
    //                 await bidInfoKV.hset('finish', name, info);
    //                 // 清理掉不需要的数据
    //                 await bidKV.hclean(name);
    //             } else {
    //                 break;
    //             }
    //         } while (true);
    //         return ErrorCode.RESULT_OK;
    //     });

    // 查询指定name的拍卖信息
    // handler.addViewMethod('GetBidInfo', async (context: DposViewContext, params: any): Promise<any> => {
    //     let value: any = {};
    //     let bidInfoKV = (await context.storage.getReadableKeyValue('bidInfo')).kv!;
    //     let bidKV = (await context.storage.getReadableKeyValue('bid')).kv!;
    //     let bid = await bidKV.get(params.name);
    //     let bidInfo = await bidInfoKV.hget(bid.err === ErrorCode.RESULT_NOT_FOUND ? 'finish' : 'biding', params.name);
    //     if (bidInfo.err !== ErrorCode.RESULT_OK) {
    //         return;
    //     }
    //     value = bidInfo.value!;
    //     value.name = params.name;
    //     if (!bidInfo.value!.owner) {
    //         value.bidder = bid.value!.caller;
    //         value.bidvalue = bid.value!.value;
    //     }

    //     return value;
    // });

    // 查询所有正在拍卖的name的信息
    // handler.addViewMethod('GetAllBiding', async (context: DposViewContext, params: any): Promise<any[]> => {
    //     let ret: any[] = [];
    //     let bidInfoKV = (await context.storage.getReadableKeyValue('bidInfo')).kv!;
    //     let bidKV = (await context.storage.getReadableKeyValue('bid')).kv!;
    //     let rets = await bidInfoKV.hgetall('biding');
    //     if (rets.err === ErrorCode.RESULT_OK) {
    //         for (const { key, value } of rets.value!) {
    //             let i = value;
    //             i.name = key;
    //             let bid = await bidKV.get(key);
    //             i.bidder = bid.value!.caller;
    //             i.bidvalue = bid.value!.value;
    //             ret.push(i);
    //         }
    //     }
    //     return ret;
    // });

    // 查询所有拍卖完成name的信息
    // handler.addViewMethod('GetAllFinished', async (context: DposViewContext, params: any): Promise<any[]> => {
    //     let ret: any[] = [];
    //     let bidInfoKV = (await context.storage.getReadableKeyValue('bidInfo')).kv!;
    //     let rets = await bidInfoKV.hgetall('finish');
    //     if (rets.err === ErrorCode.RESULT_OK) {
    //         for (const { key, value } of rets.value!) {
    //             let i = value;
    //             i.name = key;
    //             ret.push(i);
    //         }
    //     }
    //     return ret;
    // });
}
