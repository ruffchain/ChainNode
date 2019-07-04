import { ErrorCode, BigNumber, DposViewContext, DposTransactionContext, ValueHandler, IReadableKeyValue, MapToObject, Chain, isValidAddress } from '../../../../src/host';
import { bCheckDBName, bCheckTokenPrecision, bCheckMethodName, strAmountPrecision, SYS_TOKEN_PRECISION } from "./scoop";

import { createScript } from 'ruff-vm';

const DB_NAME_MAX_LEN: number = 12;
const DB_KEY_MAX_LEN: number = 256;
const DB_VALUE_MAX_LEN: number = 512;
const FEE_PER_BYTE = 0.000012;
const USER_CODE_MIN_COST: BigNumber = new BigNumber(0.001);

async function getAddressCode(codeKv: IReadableKeyValue, address: string): Promise<Buffer | undefined> {
    let retInfo = await codeKv.get(address);
    return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value.code : undefined;
}

async function getTableValue(tableKv: IReadableKeyValue, keyName: string): Promise<string | undefined> {
    let retInfo = await tableKv.get(keyName);
    return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value : undefined;
}

function getFeeCostForCode(code: string | Buffer) : BigNumber {
    let byteCost = new BigNumber(code.length * 204 * 18).div(1000000000);

    return new BigNumber(0.002).plus(byteCost);
}

export async function setUserCode(context: DposTransactionContext, params: any): Promise<ErrorCode> {
    if (!params.userCode) {
        context.cost(context.fee);
        return ErrorCode.RESULT_INVALID_PARAM;
    }

    let kvRet = await context.storage.getReadWritableKeyValue('userCode');
    if (kvRet.err) {
        return kvRet.err;
    }
    let minFee = getFeeCostForCode(params.userCode);

    if (context.fee.isLessThan(minFee)) {
        context.cost(context.fee);
        return ErrorCode.RESULT_FEE_TOO_SMALL;
    }

    kvRet = await kvRet.kv!.set(context.caller, { code: params.userCode });
    if (kvRet.err) {
        context.cost(USER_CODE_MIN_COST);
        return kvRet.err;
    }
    context.cost(minFee);

    return ErrorCode.RESULT_OK;
}

export async function getUserCode(context: DposViewContext, params: any): Promise<Buffer | undefined> {
    let kvRet = await context.storage.getReadableKeyValue('userCode');

    if (kvRet.err) {
        return undefined;
    }

    if (!isValidAddress(params.address)) {
        return undefined;
    }

    return await getAddressCode(kvRet.kv!, params.address);
}

export async function getUserTableValue(context: DposViewContext, params: any): Promise<string | undefined> {
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
}

export async function runUserMethod(context: DposTransactionContext, params: any): Promise<ErrorCode> {
    if (context.fee.isLessThan(USER_CODE_MIN_COST)) {
        context.cost(context.fee);
        return ErrorCode.RESULT_FEE_TOO_SMALL;
    }

    if (!isValidAddress(params.to)) {
        context.cost(context.fee);
        return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
    }

    let kvRet = await context.storage.getReadableKeyValue('userCode');

    if (kvRet.err) {
        return kvRet.err;
    }

    context.cost(USER_CODE_MIN_COST);

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
            // context.logger.info(arg0, arg1);
        },

        bcTransfer: async (resolve: any, to: string, amount: string): Promise<any> => {
            if (context.cost(USER_CODE_MIN_COST) != ErrorCode.RESULT_OK) {
                return resolve(false);
            }
            try {
                let toValue = new BigNumber(amount);

                if (toValue.isNaN() || !isValidAddress(to)) {
                    return (resolve(false));
                }
                if (usedValue.plus(toValue).isGreaterThan(totalValue)) {
                    context.logger.error('exceed the amount');
                    return (resolve(false));
                }

                const ret = await context
                    .transferTo(to, toValue);
                if (ret === ErrorCode.RESULT_OK) {
                    context.emit('transfer', {
                        'from': params.to,
                        'to': to,
                        'amount': toValue.toString()
                    });
                    usedValue = usedValue.plus(toValue);
                    return (resolve(true));
                } else {
                    context.logger.error('ret is', ret);
                    return (resolve(false));
                }
            } catch (err) {
                context.logger.error('err when transfer', err);
                resolve(false);
            }
        },
        bcDBCreate: async (resolve: any, name: string): Promise<any> => {
            try {

                if (context.cost(new BigNumber(FEE_PER_BYTE)) != ErrorCode.RESULT_OK) {
                    return (resolve(false));
                }
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
                context.logger.error('error when DB create', err);
                resolve(false);
            }
        },
        bcDBSet: async (resolve: any, name: string, key: string, value: string): Promise<any> => {
            if (context.cost(new BigNumber(FEE_PER_BYTE)) != ErrorCode.RESULT_OK) {
                return (resolve(false));
            }

            try {
                if (!bCheckDBName(name) || !value || !key) {
                    return (resolve(false));
                }

                if (key.length > DB_KEY_MAX_LEN || value.length > DB_VALUE_MAX_LEN) {
                    context.logger.error('Invalid input for bcDBSet');
                    return (resolve(false));
                }

                let dbName = `${receiver}-${name}`;

                const kvRet2 = await context
                    .storage
                    .getReadWritableKeyValue(dbName);

                if (kvRet2.err) {
                    return (resolve(false));
                } else {
                    if (context.cost(new BigNumber(FEE_PER_BYTE * value.length)) != ErrorCode.RESULT_OK) {
                        return (resolve(false));
                    }
                    let ret = await kvRet2.kv!.set(key, value);
                    if (ret.err) {
                        return (resolve(false));
                    } else {
                        return (resolve(true));
                    }
                }
            } catch (err) {
                context.logger.error('error when DB Set', err);
                resolve(false);
            }
        },
        bcDBGet: async (resolve: any, name: string, key: string): Promise<any> => {
            let ret;
            if (context.cost(new BigNumber(FEE_PER_BYTE)) != ErrorCode.RESULT_OK) {
                return (resolve(false));
            }

            try {

                if (!bCheckDBName(name) || !name || !key) {
                    return (resolve(ret));
                }

                if (key.length > DB_KEY_MAX_LEN) {
                    context.logger.error('Invalid input for bcDBSet');
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
                context.logger.error('error when DB Set', err);
                resolve(ret);
            }
        },
    };

    if (!bCheckMethodName(params.action)) {
        return ErrorCode.RESULT_INVALID_PARAM;
    }

    let contractParam = null;

    if (params.params && params.params.length <= 128) {
        contractParam = params.params;
    }

    let actionCode = `
            var contract = new Contract("${receiver}","${context.caller}");
            contract.${params.action}("${contractParam}");
        `;
    try {
        context.logger.info('before ruffvm runAsync');
        let ret = await createScript(code)
            .setUserCode(actionCode)
            .setSandbox(sandbox)
            .setOption({ cpuCount: 256, memSizeKB: 256 })
            .runAsync();
        context.logger.info('after ruffvm runAsync', ret);
        return ErrorCode.RESULT_OK;
    } catch (err) {
        context.logger.error('ruffvm runAsync error', err);
        return ErrorCode.RESULT_FAILED;
    }
}
