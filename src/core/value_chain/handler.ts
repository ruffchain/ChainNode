import {BigNumber} from 'bignumber.js';
import * as Handler from '../executor/handler';
import { ValueContext } from './executor';

export type MinerWageListener = (height: number) => Promise<BigNumber>; //是否需要中值时间呢？

export class ValueHandler extends Handler.BaseHandler {
    protected m_minerWage: MinerWageListener;
    constructor () {
        super();
        this.m_minerWage = (height: number): Promise<BigNumber> => {
            return Promise.resolve(new BigNumber(1));
        }
    }

    public onMinerWage(l: MinerWageListener) {
        if (l) {
            this.m_minerWage = l;
        }
    }

    public getMinerWageListener(): MinerWageListener {
        return this.m_minerWage;
    }
}