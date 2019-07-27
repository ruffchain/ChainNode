import { TxPendingChecker, Transaction } from '../core/chain';
import * as BaseJoi from '@hapi/joi';
import { ErrorCode } from './error_code';
import { BigNumberExtension } from './joi-extend';
const Joi = BaseJoi.extend(BigNumberExtension);

export const accountSchema = Joi.string().min(26).max(34).required();

export const transferToSchema = Joi.object().keys({
    to: accountSchema
});

export const transferTokenSchema = Joi.object().keys({
    to: accountSchema,
    amount: Joi.bignumber().positive().required(),
    tokenid: Joi.string().min(3).max(12).required()
});

export const createTokenSchema = Joi.object().keys({
    tokenid: Joi.string().min(3).max(12).required(),
    preBalances: Joi.array().items(Joi.object().keys({
        address: accountSchema,
        amount: Joi.string().max(64).required(),
    })).required(),
    precision: Joi.number().integer().min(0).max(9).required()
})

export function genChecker(schema: BaseJoi.AnySchema): TxPendingChecker {
    return (tx: Transaction) => {
        if (schema.validate(tx.input).error) {
            return ErrorCode.RESULT_INVALID_PARAM;
        } else {
            return ErrorCode.RESULT_OK;
        }
    };
}
