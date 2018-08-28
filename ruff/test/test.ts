import 'mocha';
import * as path from 'path';
const assert = require('assert');
import {createValueMemoryDebuger, initChainCreator, initLogger, stringifyErrorCode, ValueMemoryDebugSession, BigNumber, ErrorCode} from '../../src/core';

process.on('unhandledRejection', (reason, p) => {
    console.log('未处理的 rejection：', p, '原因：', reason);
    // 记录日志、抛出错误、或其他逻辑。
});

describe('token', () => {
    const logger = initLogger({loggerOptions: {console: true}});
    let session: ValueMemoryDebugSession;
    before((done) => {
        async function __test() {
            const mdr = await createValueMemoryDebuger(initChainCreator({logger}), path.join(__dirname, '../chain'));
            assert(!mdr.err, 'createValueMemoryDebuger failed', stringifyErrorCode(mdr.err));
            const debuger = mdr.debuger!;
            session = debuger.createSession();
            assert(!(await session.init({height: 0, accounts: 2, coinbase: 0, interval: 10, preBalance: 100000})), 'init session failed');
        }
        __test().then(done);
    });

    it('wage', (done) => {
        async function __test() {
            assert(!(await session!.wage()).err, 'wage error');
            const gbr = await session.view({method: 'getBalance', params: {address: session!.getAccount(0)}});
            assert(!gbr.err, 'getBalance failed error');
            assert((gbr.value! as BigNumber).eq(100001), `wage value error, actual ${(gbr.value! as BigNumber).toString()}`);
        }
        __test().then(done);
    });

    it('transferTo', (done) => {
        async function __test() {
            let acc0Balance: BigNumber = (await session.view({method: 'getBalance', params: {address: session!.getAccount(0)}})).value!;
            let acc1Balance: BigNumber = (await session.view({method: 'getBalance', params: {address: session!.getAccount(1)}})).value!;

            assert(!(await session.transaction({caller: 0, method: 'transferTo', input: {to: session.getAccount(1)}, value: new BigNumber(10)})).err, 'transferTo failed');
            let gbr = await session.view({method: 'getBalance', params: {address: session!.getAccount(0)}});
            assert(gbr.value!.eq(acc0Balance.minus(10)), `0 balance value err, actual ${gbr.value!.toString()}, except ${acc0Balance.minus(10)}`);
            gbr = await session.view({method: 'getBalance', params: {address: session!.getAccount(1)}});
            assert(gbr.value!.eq(acc1Balance.plus(10)), `1 balance value err, actual ${gbr.value!.toString()}, except ${acc1Balance.plus(10)}`);
        }
        __test().then(done);
    });

    it('token', (done) => {
        async function __test() {
            let terr = await session.transaction(
                {
                    caller: 0, 
                    method: 'createToken', 
                    input: {
                        tokenid: 'token1', 
                        preBalances: [
                            {address: session.getAccount(0), amount: '1000000'}
                        ]
                    },
                    value: new BigNumber(0)
                }
            );
            assert(!terr.err && !terr.receipt!.returnCode, `createToken failed. ${terr.err}`);
            terr = await session.transaction(
                {
                    caller: 0, 
                    method: 'createToken', 
                    input: {
                        tokenid: 'token1', 
                        preBalances: [
                            {address: session.getAccount(0), amount: '1000000'}
                        ]
                    },
                    value: new BigNumber(0)
                }
            );
            assert(!terr.err && terr.receipt!.returnCode === ErrorCode.RESULT_ALREADY_EXIST, ` reCreateToken failed. ${terr.err}`);
            terr = await session.transaction(
                {
                    caller: 0, 
                    method: 'createToken', 
                    input: {
                        tokenid: 'token2', 
                        preBalances: [
                            {address: session.getAccount(0), amount: '2000000'}
                        ]
                    },
                    value: new BigNumber(0)
                }
            );
            assert(!terr.err && !terr.receipt!.returnCode, `createToken2 failed. ${terr.err}`);
            let gbr = await session.view({method: 'getTokenBalance', params: {tokenid: 'token1', address: session.getAccount(0)}});
            assert(gbr.value!.eq(1000000), `0 Token balance value err, actual ${gbr.value}`);

            terr = await session.transaction(
                {
                    caller: 0, 
                    method: 'transferTokenTo', 
                    input: {
                        tokenid: 'token1', 
                        to: session.getAccount(1),
                        amount: 100
                    },
                    value: new BigNumber(0)
                }
            );
            assert(!terr.err && !terr.receipt!.returnCode, `transferTokenTo failed. ${terr.err}`);
            gbr = await session.view({method: 'getTokenBalance', params: {tokenid: 'token1', address: session.getAccount(0)}});
            assert(gbr.value!.eq(1000000 - 100), `0 Token balance value err, actual ${gbr.value}`);
            gbr = await session.view({method: 'getTokenBalance', params: {tokenid: 'token1', address: session.getAccount(1)}});
            assert(gbr.value!.eq(100), '1 Token balance value err, actual ${gbr.value}');
        }
        __test().then(done);
    });
});