import * as Joi from '@hapi/joi';
import {BigNumber} from 'bignumber.js'

export const BigNumberExtension: Joi.Extension = {
    name: 'bignumber',

    language: {
        nan: '!!"{{v}}" is not a number',
        max: '!!"{{v}}" needs to be less than or equal to "{{max}}"',
        min: '!!"{{v}}" needs to be greater than or equal to "{{min}}"',
        less: '!!"{{v}}" needs to be less than "{{max}}"',
        greater: '!!"{{v}}" needs to be greater than "{{min}}"',
        integer: '!!"{{v}}" needs to be integer',
        multiple: '!!"{{v}}" needs to be multiple of "{{multiplier}}"',
        positive: '!!"{{v}}" needs to be positive',
        negative: '!!"{{v}}" needs to be negative',
    },

    pre(value, state, options) {
        const _this: any = this;

        if (!value) {
            return value;
        }

        let bnValue = new BigNumber(value);

        if (bnValue.isNaN()) {
            return this.createError('bignumber.nan', { v: value }, state, options);
        }

        if (_this._flags.precision) {
            bnValue = new BigNumber(bnValue.toPrecision(_this._flags.precision, _this._flags.rounding));
        }

        return options.convert ? bnValue : value;
    },

    rules: [
        {
            name: 'min',
            description: 'Minimal bignumber value',
            params: {
                value: Joi.alternatives([Joi.object().type(BigNumber), Joi.number(), Joi.string()]).required()
            },
            validate(params, value: BigNumber, state, options) {
                const min = new BigNumber(params.value)

                // check whether number value is less then minimal value
                if (!new BigNumber(value).isGreaterThanOrEqualTo(min)) {
                    return this.createError('bignumber.min', {v: value, min}, state, options);
                }

                // Everything is ok
                return value;
            }
        },
        {
            name: 'max',
            description: 'Maximal bignumber value',
            params: {
                value: Joi.alternatives([Joi.object().type(BigNumber), Joi.number(), Joi.string()]).required()
            },
            validate(params, value: BigNumber, state, options) {
                const max = new BigNumber(params.value);

                // check whether number value is greater then maximal value
                if (!new BigNumber(value).isLessThanOrEqualTo(max)) {
                    return this.createError('bignumber.max', {v: value, max}, state, options);
                }

                // Everything is ok
                return value;
            }
        },
        {
            name: 'greater',
            description: 'Greater than bignumber value',
            params: {
                value: Joi.alternatives([Joi.object().type(BigNumber), Joi.number(), Joi.string()]).required()
            },
            validate(params, value: BigNumber, state, options) {
                const min = new BigNumber(params.value)

                // check whether number value is less then minimal value
                if (!new BigNumber(value).isGreaterThan(min)) {
                    return this.createError('bignumber.greater', {v: value, min}, state, options);
                }

                // Everything is ok
                return value;
            }
        },
        {
            name: 'less',
            description: 'Less than bignumber value',
            params: {
                value: Joi.alternatives([Joi.object().type(BigNumber), Joi.number(), Joi.string()]).required()
            },
            validate(params, value: BigNumber, state, options) {
                const max = new BigNumber(params.value);

                // check whether number value is greater then maximal value
                if (!new BigNumber(value).isLessThan(max)) {
                    return this.createError('bignumber.less', {v: value, max}, state, options);
                }

                // Everything is ok
                return value;
            }
        },
        {
            name: 'integer',
            description: 'Integer value',
            validate(params, value: BigNumber, state, options) {
                // check whether number value is integer
                if (!new BigNumber(value).isInteger()) {
                    return this.createError('bignumber.integer', {v: value}, state, options);
                }

                // Everything is ok
                return value;
            }
        },
        {
            name: 'precision',
            description: 'Value precision',
            params: {
                value: Joi.number().integer().positive().required(),
                rounding: Joi.number().allow(0, 1, 2, 3, 4, 5, 6, 7, 8).default(4)
            },
            setup(params) {
                const _this: any = this;
                _this._flags.precision = params.value;
                _this._flags.rounding = params.rounding;
            },
            validate(params, value: Number, state, options) {
                return value;
            }
        },
        {
            name: 'multiple',
            description: 'Multiple of value',
            params: {
                value: Joi.alternatives([Joi.object().type(BigNumber), Joi.number(), Joi.string()]).required()
            },
            validate(params, value: BigNumber, state, options) {
                const multiplier = new BigNumber(params.value);

                // check whether number value is multiple of multiplier
                if(!new BigNumber(value).mod(multiplier).eq('0')) {
                    return this.createError('bignumber.multiple', {v: value, multiplier}, state, options);
                }

                // Everything is ok
                return value;
            }
        },
        {
            name: 'positive',
            description: 'Positive value',
            validate(params, value: BigNumber, state, options) {
                // check whether value is positive
                if(!new BigNumber(value).isPositive()) {
                    return this.createError('bignumber.positive', {v: value}, state, options);
                }

                // Everything is ok
                return value;
            }
        },
        {
            name: 'negative',
            description: 'Negative value',
            validate(params, value: BigNumber, state, options) {
                // check whether value is negative
                if(!new BigNumber(value).isNegative()) {
                    return this.createError('bignumber.negative', {v: value}, state, options);
                }

                // Everything is ok
                return value;
            }
        }
    ]
};
