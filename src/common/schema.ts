import { TxPendingChecker, Transaction } from '../core/chain';
import { ValueTransaction } from '../core/value_chain/transaction'
import * as BaseJoi from '@hapi/joi';
import { ErrorCode } from './error_code';
import { BigNumberExtension } from './joi-extend';
const Joi = BaseJoi.extend(BigNumberExtension);

const amountSchema = Joi.bignumber().positive().required();
const accountSchema = Joi.string().min(26).max(34).required();
const tokenidSchema = Joi.string().min(3).max(12).required();
const preBalancesSchema = Joi.array().max(50).items(Joi.object().keys({
    address: accountSchema,
    amount: amountSchema,
})).required();

const preBalancesBancorSchema = Joi.array().max(50).items(Joi.object().keys({
    address: accountSchema,
    amount: amountSchema,
    lock_amount: amountSchema,
    time_expiration: Joi.number().integer().min(1).required(),
})).required();

const precisionSchema = Joi.number().integer().min(0).max(9).required();

const stringWithMaxLen32 = Joi.string().min(1).max(32).required();
const stringWithMaxLen20 = Joi.string().min(1).max(20).required();
const stringWithMaxLen50 = Joi.string().min(1).max(50).required();

export const transferToSchema = Joi.object().keys({
    to: accountSchema
});

export const transferTokenSchema = Joi.object().keys({
    to: accountSchema,
    amount: amountSchema,
    tokenid: tokenidSchema
});

export const createTokenSchema = Joi.object().keys({
    tokenid: tokenidSchema,
    preBalances: preBalancesSchema,
    precision: precisionSchema
});

export const createBancorTokenSchema = Joi.object().keys({
    tokenid: tokenidSchema,
    preBalances: preBalancesBancorSchema,
    factor: stringWithMaxLen32,
    nonliquidity: Joi.string().min(1).max(32)
});

export const transferTokenToMultiAccoutSchema = Joi.object().keys({
    tokenid: tokenidSchema,
    to: preBalancesSchema
});

export const buyTokenSchema = Joi.object().keys({
    tokenid: tokenidSchema
});

export const sellTokenSchema = Joi.object().keys({
    tokenid: tokenidSchema,
    amount: amountSchema
});

export const registerSchema = Joi.object().keys({
    name: stringWithMaxLen20,
    ip: stringWithMaxLen50,
    url: stringWithMaxLen50,
    location: stringWithMaxLen50
});

export const unregisterSchema = accountSchema;

export const voteScheme = Joi.array().min(1).max(7).items(accountSchema).required();

export const mortgageSchema = amountSchema;

export const userCodeSchema = Joi.object().keys({
    userCode: Joi.binary().max(100*1024).required()
});

export function genChecker(schema?: BaseJoi.AnySchema): TxPendingChecker {
    return (tx: Transaction) => {
        const valueTx = tx as ValueTransaction;
        try {
            let dp = valueTx.value.decimalPlaces();
            if (dp >= 0 && dp <= 9) {
                if (schema && schema.validate(tx.input).error) {
                    return ErrorCode.RESULT_INVALID_PARAM;
                }
                return ErrorCode.RESULT_OK;
            } else {
                return ErrorCode.RESULT_INVALID_PARAM;
            }
        } catch(err) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
    };
}
