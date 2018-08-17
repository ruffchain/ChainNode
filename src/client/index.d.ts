export {BigNumber} from 'bignumber.js';
import {LoggerInstance} from 'winston';

export enum ErrorCode {
    RESULT_OK = 0,
    RESULT_FAILED = 1,

    RESULT_WAIT_INIT = 2,
    RESULT_ERROR_STATE = 3,
    RESULT_INVALID_TYPE = 4,
    RESULT_SCRIPT_ERROR = 5,
    RESULT_NO_IMP = 6,
    RESULT_ALREADY_EXIST = 7,
    RESULT_NEED_SYNC = 8,
    RESULT_NOT_FOUND = 9,
    RESULT_EXPIRED = 10,
    RESULT_INVALID_PARAM = 11,
    RESULT_PARSE_ERROR = 12,
    RESULT_REQUEST_ERROR = 13,
    RESULT_NOT_SUPPORT = 14,
    RESULT_TIMEOUT = 15,
    RESULT_EXCEPTION = 16,
    RESULT_INVALID_FORMAT = 17,
    RESULT_UNKNOWN_VALUE = 18,
    RESULT_INVALID_TOKEN = 19, // token无效
    RESULT_INVALID_SESSION = 21, // 会话无效
    RESULT_OUT_OF_LIMIT = 22, // 超出最大限制
    RESULT_PERMISSION_DENIED = 23, // 权限不足
    RESULT_OUT_OF_MEMORY = 24, // 内存不足
    RESULT_INVALID_STATE = 25,  // 无效状态
    RESULT_NOT_ENOUGH = 26, // 转账时钱不够,
    RESULT_ERROR_NONCE_IN_TX = 27, // tx中的nonce错误
    RESULT_INVALID_BLOCK = 28, // 无效的Block
    RESULT_CANCELED = 29, // 操作被取消

    RESULT_FEE_TOO_SMALL = 30, // 操作被取消
    RESULT_READ_ONLY = 31,
    RESULT_BALANCE_LOCK_EXIST = 32,
    RESULT_BALANCE_LOCK_NOT_EXIST= 33,
    RESULT_TX_EXIST = 34,
    RESULT_VER_NOT_SUPPORT = 35,
    RESULT_EXECUTE_ERROR = 36,

    RESULT_SKIPPED = 40,

    RESULT_FORK_DETECTED = 50,
}

export function stringify(v: any, parsable?:boolean): any;
export function parseJSON(v: any): any;
export function rejectifyValue<T>(func: (...args: any[]) => Promise<{err: ErrorCode, value?: T}>, _this: any): (...args: any[]) => Promise<T>;
export function rejectifyErrorCode(func: (...args: any[]) => Promise<ErrorCode>, _this: any): (...args: any[]) => Promise<void>;

export class Transaction {
   constructor();

    readonly address?:string;

    method: string;

    nonce: number;

    input: any;

    sign(privateKey: Buffer|string): void;
}

import {BigNumber} from 'bignumber.js';

export class ValueTransaction extends Transaction {
    constructor();

    value: BigNumber;

    fee: BigNumber;
}


export interface IReadableKeyValue {
    // 单值操作
    get(key: string): Promise<{ err: ErrorCode, value?: any }>;

    // hash
    hexists(key: string, field: string): Promise<{ err: ErrorCode, value?: boolean}>;
    hget(key: string, field: string): Promise<{ err: ErrorCode, value?: any }>;
    hmget(key: string, fields: string[]): Promise<{ err: ErrorCode, value?: any[] }>;
    hlen(key: string): Promise<{ err: ErrorCode, value?: number }>;
    hkeys(key: string): Promise<{ err: ErrorCode, value?: string[] }>;
    hvalues(key: string): Promise<{ err: ErrorCode, value?: any[] }>;
    hgetall(key: string): Promise<{ err: ErrorCode; value?: any[]; }>;

    // array
    lindex(key: string, index: number): Promise<{ err: ErrorCode, value?: any }>;
    llen(key: string): Promise<{ err: ErrorCode, value?: number }>;
    lrange(key: string, start: number, stop: number): Promise<{ err: ErrorCode, value?: any[] }>;
}

export interface IWritableKeyValue {
    // 单值操作
    set(key: string, value: any): Promise<{ err: ErrorCode }>;
    
    // hash
    hset(key: string, field: string, value: any): Promise<{ err: ErrorCode }>;
    hmset(key: string, fields: string[], values: any[]): Promise<{ err: ErrorCode }>;
    hclean(key: string): Promise<ErrorCode>;
    hdel(key: string, field: string): Promise<{err: ErrorCode}>;
    
    // array
    lset(key: string, index: number, value: any): Promise<{ err: ErrorCode }>;
    lpush(key: string, value: any): Promise<{ err: ErrorCode }>;
    lpushx(key: string, value: any[]): Promise<{ err: ErrorCode }>;
    lpop(key: string): Promise<{ err: ErrorCode, value?: any }>;

    rpush(key: string, value: any): Promise<{ err: ErrorCode }>;
    rpushx(key: string, value: any[]): Promise<{ err: ErrorCode }>;
    rpop(key: string): Promise<{ err: ErrorCode, value?: any }>;

    linsert(key: string, index: number, value: any): Promise<{ err: ErrorCode }>;
    lremove(key: string, index: number): Promise<{ err: ErrorCode, value?: any }>;
}

export type IReadWritableKeyValue = IReadableKeyValue & IWritableKeyValue;

export interface IReadableDataBase {
    getReadableKeyValue(name: string): Promise<{ err: ErrorCode, kv?: IReadableKeyValue }>;
}

export interface IWritableDataBase {
    createKeyValue(name: string): Promise<{err: ErrorCode, kv?: IReadWritableKeyValue}>;
    getReadWritableKeyValue(name: string): Promise<{ err: ErrorCode, kv?: IReadWritableKeyValue }>;
}

export type IReadWritableDataBase = IReadableDataBase & IWritableDataBase;

export type ExecutorContext = {
    now: number;
    height: number;
    logger: LoggerInstance;
};

export type TransactionContext = {
    caller: string;
    storage: IReadWritableDataBase;
    emit: (name: string, param?: any) => void;
} & ExecutorContext;

export type EventContext = {
    storage: IReadWritableDataBase;
} & ExecutorContext;

export type ViewContext = {
    storage: IReadableDataBase;
} & ExecutorContext;

export type ValueTransactionContext = {
    value: BigNumber;
    getBalance: (address: string) => Promise<BigNumber>;
    transferTo: (address: string, amount: BigNumber) => Promise<ErrorCode>;
} & TransactionContext;

export type ValueEventContext = {
    getBalance: (address: string) => Promise<BigNumber>;
    transferTo: (address: string, amount: BigNumber) => Promise<ErrorCode>;
} & EventContext;

export type ValueViewContext = {
    getBalance: (address: string) => Promise<BigNumber>;
} & ViewContext;

export type DposTransactionContext = {
    vote: (from: string, candiates: string) => Promise<ErrorCode>;
    mortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    unmortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    register: (from: string) => Promise<ErrorCode>;
} & ValueTransactionContext;

export type DposEventContext = {
    vote: (from: string, candiates: string) => Promise<ErrorCode>;
    mortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    unmortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    register: (from: string) => Promise<ErrorCode>;
} & ValueEventContext;

export type DposViewContext = {
    getVote: () => Promise<Map<string, BigNumber> >;
    getStoke: (address: string) => Promise<BigNumber>;
    getCandidates: () => Promise<string[]>;
} & ValueViewContext;

export function addressFromSecretKey(secret: Buffer|string): string|undefined;

export function isValidAddress(address: string): boolean;

export function toWei(value: string | number | BigNumber): BigNumber;

export function fromWei(value: string | number | BigNumber): BigNumber;

export function toCoin(value: string | number | BigNumber): BigNumber;

export function fromCoin(value: string | number | BigNumber): BigNumber;


export class ChainClient {
    constructor(options: {host: string, port: number});

    getBlock(params: {which: string|number|'lastest', transactions?: boolean}): Promise<{err: ErrorCode, block?: any}>;

    getTransactionReceipt(params: {tx: string}): Promise<{err: ErrorCode, block?: any, tx?: any, receipt?: any}>;

    getNonce(params: {address: string}): Promise<{err: ErrorCode, nonce?: number}>;

    sendTransaction(params: {tx: ValueTransaction}): Promise<{err: ErrorCode}>;

    view(params: {method: string, params: any, from?: number|string|'latest'}): Promise<{err: ErrorCode, value?: any}>;

    on(event: 'tipBlock', listener: (block: any) => void): this;
    once(event: 'tipBlock', listener: (block: any) => void): this;
}

// export * from './lib/simple_command';
// export {init as initUnhandledRejection} from './lib/unhandled_rejection';

type TxListener = (context: any, params: any) => Promise<ErrorCode>;
type BlockHeigthFilter = (height: number) => Promise<boolean>;
type BlockHeightListener = (context: any) => Promise<ErrorCode>;
type ViewListener = (context: any, params: any) => Promise<any>;

export class BaseHandler {
    constructor();

    genesisListener?: BlockHeightListener;
    
    addTX(name: string, listener: TxListener): void;

    getListener(name: string): TxListener|undefined;

    addViewMethod(name: string, listener: ViewListener): void;

    getViewMethod(name: string): ViewListener|undefined;

    addPreBlockListener(filter: BlockHeigthFilter, listener: BlockHeightListener): void;

    getPreBlockListeners(h: number): Promise<BlockHeightListener[]>;

    addPostBlockListener(filter: BlockHeigthFilter, listener: BlockHeightListener): void;

    getPostBlockListeners(h: number): Promise<BlockHeightListener[]>;
}


type MinerWageListener = (height: number) => Promise<BigNumber>; 

export class ValueHandler extends BaseHandler {
    constructor();

    onMinerWage(l: MinerWageListener): any;

    getMinerWageListener(): MinerWageListener;
}

export const handler: ValueHandler;
