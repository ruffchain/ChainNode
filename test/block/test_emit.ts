import 'mocha';
import * as path from 'path';
import * as fs from 'fs-extra';
const assert = require('assert');
import {BigNumber, Block, Transaction, initLogger, HeaderStorage, Receipt, createValueDebuger, ValueChainDebuger, initChainCreator, ChainCreator, ValueBlockHeader, ValueTransaction, ValueReceipt, InprocessRoutineManager, InterprocessRoutineManager, ErrorCode } from '../../src/core';

process.on('unhandledRejection', (reason, p) => {
    console.log('未处理的 rejection：', p, '原因：', reason);
    // 记录日志、抛出错误、或其他逻辑。
});

describe('emitEvents', () => {
    const logger = initLogger({loggerOptions: {console: true, level: 'debug'}});
    let creator: ChainCreator;
    let debuger: ValueChainDebuger;
    const rootDir = path.join(__dirname, '../../../../data/test/testEmit');
    before((done) => {
        async function __test() {
            fs.removeSync(rootDir);
            fs.ensureDirSync(rootDir);
            const packagePath = path.join(rootDir, 'package');
            fs.ensureDirSync(packagePath);
            const dataDir = path.join(rootDir, 'data');
            fs.ensureDirSync(dataDir);
            const configContent = `
            {
                "handler":"./handler.js",
                "type": {
                    "consensus":"pow",
                    "features":[]
                },
                "global": {
                    "retargetInterval":10,
                    "targetTimespan":60,
                    "basicBits":520159231,
                    "limit":"0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
                }
            }
            `;
            fs.writeFileSync(path.join(packagePath, 'config.json'), configContent);
            const handlerContent = `
                "use strict";
                Object.defineProperty(exports, "__esModule", { value: true });
                const client_1 = require("../../../../dist/blockchain-sdk/src/client");
                function registerHandler(handler) {
                    handler.defineEvent('transfer', { indices: ['from', 'to'] });
                    handler.addTX('transferTo', async (context, params) => {
                        const err = await context.transferTo(params.to, context.value);
                        if (!err) {
                            context.emit('transfer', { from: context.caller, to: params.to, value: context.value });
                        }
                        return err;
                    });
                    handler.onMinerWage(async () => {
                        return new client_1.BigNumber(10000);
                    });
                }
                exports.registerHandler = registerHandler;
            `;
            fs.writeFileSync(path.join(packagePath, 'handler.js'), handlerContent);
            creator = initChainCreator({logger});
            const cgr = await creator.createGenesis(packagePath, dataDir, {
                coinbase: '12LKjfgQW26dQZMxcJdkj2iVP2rtJSzT88', 
                preBalance: []});
            assert(!cgr.err, 'create genesis failed');
        
            const vdr = await createValueDebuger(creator, dataDir);
            assert(!vdr.err, 'create debuger failed');
            debuger = vdr.debuger!;
        }
        __test().then(done);
    });

    it(`emit 1 event in transaction`, (done) => {
        async function __test() {
            const session = debuger.createIndependSession();
            let sir = await session.init({height: 0, accounts: 2, coinbase: 0, interval: 0, preBalance: new BigNumber(100)});
            assert(!sir.err, 'init session failed');
            const tr = await session.transaction({caller: 0, method: 'transferTo', input: {to: session.getAccount(1)}, value: new BigNumber(100), fee: new BigNumber(0)});
            assert(!tr.err, 'execute transaction failed');
            assert(!tr.receipt!.returnCode, 'transfer transaction return failed');
            const eventLogs = tr.receipt!.eventLogs;
            assert(eventLogs.length === 1, 'transfer event missing');
            assert(eventLogs[0].name === 'transfer', 'transfer event name error');
            assert(eventLogs[0].param.from === session.getAccount(0)
                && eventLogs[0].param.to === session.getAccount(1)
                && (eventLogs[0].param.value as BigNumber).eq(new BigNumber(100)), 
                'transfer event params error');
        }
        __test().then(done);
    });

});