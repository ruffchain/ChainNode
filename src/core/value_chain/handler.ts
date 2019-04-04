import { BigNumber } from 'bignumber.js';
import { BaseHandler } from '../chain';

// Added by Yang Jun 2019-3-27
import * as fs from 'fs';
import { IfConfigGlobal } from '../../../ruff/dposbft/chain/handler'

// Added by Yang Jun 2019-3-27
let configBuffer = fs.readFileSync('./dist/blockchain-sdk/ruff/dposbft/chain/config.json');
let configObj: IfConfigGlobal;
try {
    configObj = JSON.parse(configBuffer.toString())
} catch (e) {
    throw new Error('valuechain/handler.ts read ./config.json')
}
let MINER_REWARD: number;
if (configObj.global.blockInterval === 10) {
    MINER_REWARD = 12;
} else if (configObj.global.blockInterval === 6) {
    MINER_REWARD = 7;
} else {
    throw new Error('valuechain/handler.ts read ./config.json, blockInterval invalid:' + configObj.global.blockInterval);
}

// 是否需要中值时间呢？
export type MinerWageListener = (height: number) => Promise<BigNumber>;

export class ValueHandler extends BaseHandler {
    protected m_minerWage: MinerWageListener;

    constructor() {
        super();
        this.m_minerWage = (height: number): Promise<BigNumber> => {
            // Added by Yang Jun 2019-3-27
            return Promise.resolve(new BigNumber(MINER_REWARD));
            // return Promise.resolve(new BigNumber(1));
        };
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
