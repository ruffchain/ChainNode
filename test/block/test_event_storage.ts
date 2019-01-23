import 'mocha';
import * as path from 'path';
import * as fs from 'fs-extra';
const assert = require('assert');

import {BigNumber, createValueDebuger, BlockHeader, initLogger, Receipt, ChainCreator, ValueChainDebuger, initChainCreator, ErrorCode, ValueIndependDebugSession  } from '../../src/core';
// import {ChainEventStorage} from '../../src/host/event/storage';
import {ChainEventFilterStub} from '../../src/host/event/stub';

process.on('unhandledRejection', (reason, p) => {
    console.log('未处理的 rejection：', p, '原因：', reason);
    // 记录日志、抛出错误、或其他逻辑。
});

// describe('eventStorage', () => {
//     // let eventStorage: ChainEventStorage;
//     const logger = initLogger({loggerOptions: {console: true, level: 'error'}});

//     let creator: ChainCreator;
//     let debuger: ValueChainDebuger;
//     let session: ValueIndependDebugSession;
//     before((done) => {
//         async function __test() {
//             const rootDir = path.join(__dirname, '../../../../data/test/testEventStorage');
//             fs.removeSync(rootDir);
//             fs.ensureDirSync(rootDir);

//             const packagePath = path.join(rootDir, 'package');
//             fs.ensureDirSync(packagePath);
//             const dataDir = path.join(rootDir, 'data');
//             fs.ensureDirSync(dataDir);
//             const configContent = `
//             {
//                 "handler":"./handler.js",
//                 "type": {
//                     "consensus":"pow",
//                     "features":[]
//                 },
//                 "global": {
//                     "retargetInterval":10,
//                     "targetTimespan":60,
//                     "basicBits":520159231,
//                     "limit":"0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
//                 }
//             }
//             `;
//             fs.writeFileSync(path.join(packagePath, 'config.json'), configContent);
//             const handlerContent = `
//                 "use strict";
//                 Object.defineProperty(exports, "__esModule", { value: true });
//                 const client_1 = require("../../../../dist/blockchain-sdk/src/client");
//                 function registerHandler(handler) {
//                     handler.defineEvent('transfer', { indices: ['from', 'to'] });
//                     handler.addTX('transferTo', async (context, params) => {
//                         const err = await context.transferTo(params.to, context.value);
//                         if (!err) {
//                             context.emit('transfer', { from: context.caller, to: params.to, value: context.value });
//                         }
//                         return err;
//                     });
//                     handler.onMinerWage(async () => {
//                         return new client_1.BigNumber(10000);
//                     });
//                 }
//                 exports.registerHandler = registerHandler;
//             `;
//             fs.writeFileSync(path.join(packagePath, 'handler.js'), handlerContent);
//             creator = initChainCreator({logger});
//             const cgr = await creator.createGenesis(packagePath, dataDir, {
//                 coinbase: '12LKjfgQW26dQZMxcJdkj2iVP2rtJSzT88', 
//                 preBalance: []});
//             assert(!cgr.err, 'create genesis failed');

//             const vdr = await createValueDebuger(creator, dataDir);
//             assert(!vdr.err, 'create debuger failed');
//             debuger = vdr.debuger!;

//             session = debuger.createIndependSession();
//             let sir = await session.init({height: 0, accounts: 2, coinbase: 0, interval: 0, preBalance: new BigNumber(100)});
//             assert(!sir.err, 'init session failed');

//             let dbPath = path.join(dataDir, 'events');
//             eventStorage = new ChainEventStorage({
//                 logger, 
//                 dbPath, 
//                 eventDefinations: debuger.chain.handler.getEventDefinations()
//             });
//         }
//         __test().then(done);
//     });

//     it('init', (done) => {
//         async function __test() {
//             let ir = await eventStorage.init({});
//             assert(ir.err === ErrorCode.RESULT_NOT_FOUND, `init err`);
//         }
//         __test().then(done);
//     });

//     it('add genesis', (done) => {
//         async function __test() {
//             const nhr = await session.nextHeight(0, []);
//             assert(!nhr.err, 'next height err');
//             const genesis = nhr.block!;
//             let err = await eventStorage.addBlock(genesis);
//             assert(!err, `add genesis failed ${err}`);

//             const glbr = await eventStorage.getLatestBlock();
//             assert(!glbr.err, `get latest block failed`);
//             assert(glbr.latest!.number === 0 && glbr.latest!.hash === genesis.hash, `get latest block not genesis`);

//             const queryFilter = new Map();
//             queryFilter.set('transfer', null);
//             const qr = await eventStorage.getEvents({
//                 blocks: [nhr.block!.hash, 'another hash'], 
//                 querySql: queryFilter
//             });
//             assert(!qr.err, `get events of genesis failed`);
//             const qe = qr.events!;
//             assert(qe.size === 1 && qe.get(genesis.hash) && qe.get(genesis.hash)!.length === 0, `get events of genesis mismatch`);

//         }
//         __test().then(done);
//     });

//     it('init stub', (done) => {
//         async function __test() {
//             let stub = new ChainEventFilterStub({
//                 transfer:  {
//                     $or: [
//                         {from: session.getAccount(0)},
//                         {to: session.getAccount(0)}
//                     ]
//                 }
//             });
//             stub.init();
//         }
//         __test().then(done);
//     });
// });