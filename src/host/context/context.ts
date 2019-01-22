import {Chain, LoggerInstance, ErrorCode, BlockHeader, stringifyErrorCode, EventLog, Block} from '../../core';
import { isNullOrUndefined, isString, isObject } from 'util';
import * as path from 'path';
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';
import {ElementCreator, elementRegister as ElementRegister} from './element_creator';
import {IElement, ElementOptions} from './element';
import * as fs from 'fs-extra';

const initBlockTableSql = `CREATE TABLE IF NOT EXISTS "blocks"("number" INTEGER NOT NULL UNIQUE, "hash" CHAR(64) NOT NULL)`;

export type ContextOptions = ElementOptions & {};
export class HostChainContext {
    private m_db?: sqlite.Database;
    private m_logger: LoggerInstance;
    private m_chain: Chain;
    private m_elementList: Map<string, IElement> = new Map();
    private m_options: ContextOptions;
    private m_syncing: boolean = false;

    constructor(options: ContextOptions) {
        this.m_options = options;
        this.m_chain = options.chain;
        this.m_logger = options.chain.logger; 
    }

    public getElement(name: string): IElement | undefined {
        return this.m_elementList.get(name);
    }

    public async init(names: string[]): Promise<ErrorCode> {
        let vNames: string[] = [];
        for (let name of names) {
            let creator: ElementCreator | undefined = ElementRegister.get(name);
            if (creator) {
                let element: IElement = creator(this.m_options);
                this.m_elementList.set(name, element);
                vNames.push(name);
            }
        }

        if (!vNames.length) {
            this.m_logger.error(`HostChainContext init failed for not exist valid element`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        let dbname: string = '';
        vNames.sort().forEach((n: string) => {
            if (!dbname.length) {
                dbname = n;
            } else {
                dbname += '_' + n;
            }
        });
        let dbpath = path.join(this.m_chain.dataDir, dbname);
        if (!fs.existsSync(dbpath)) {
            // 查找是否有存在多组合element的数据库存在，如果存在拷贝过来
            let files: string[] = fs.readdirSync(this.m_chain.dataDir);
            for (let file of files) {
                let name = path.basename(file);
                if (name.indexOf(dbname) !== -1) {
                    fs.copyFileSync(file, dbpath);
                }
            }
        }

        let sqliteOptions: any = {};
        sqliteOptions.mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE;
        try {
            this.m_db = await sqlite.open(dbpath, sqliteOptions);
            await this.m_db!.run(initBlockTableSql);
        } catch (e) {
            this.m_logger.error(`HostChainContext init failed for open database failed, e=${e}`);
            return ErrorCode.RESULT_EXCEPTION;
        }

        for (let [name, e] of this.m_elementList) {
            let err = await e.init(this.m_db);
            if (err) {
                this.m_logger.error(`HostChainContext init failed for init element '${name}' failed, e=${e}`);
                return err;
            }
        }

        this.m_chain.on('tipBlock', (c: Chain, header: BlockHeader) => {
            this._addBlock(header);
        });
        return ErrorCode.RESULT_OK;
    }

    protected async _getLatestBlock(): Promise<{err: ErrorCode, latest?: {number: number, hash: string}}> {
        let latest;
        try {
            latest = await this.m_db!.get(`SELECT * FROM blocks ORDER BY number DESC`);
        } catch (e) {
            this.m_logger.error('sql get latest block failed ', e);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
        if (!latest) {
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }
        return {err: ErrorCode.RESULT_OK, latest};
    }

    protected async _getBlockByNumber(num: number): Promise<{err: ErrorCode, latest?: {number: number, hash: string}}> {
        let latest;
        try {
            latest = await this.m_db!.get(`SELECT * FROM blocks where number=${num}`);
        } catch (e) {
            this.m_logger.error('sql get latest block failed ', e);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
        if (!latest) {
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }
        return {err: ErrorCode.RESULT_OK, latest};
        
    }

    protected async _addBlockToElements(block: Block): Promise<{err: ErrorCode, failedName?: string}> {
        try {
            await this.m_db!.run(`INSERT INTO blocks (number, hash) VALUES (${block.number}, "${block.hash}")`);
        } catch (e) {
            this.m_logger.info(`HostChainContext, _addBlockToElements failed e=${e}`);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
        for (let [name, e] of this.m_elementList) {
            let err = await e.addBlock(block);
            if (err) {
                return {err, failedName: name};
            }
        }

        return {err: ErrorCode.RESULT_OK};
    }

    protected async _revertToBlock(num: number): Promise<{err: ErrorCode, failedName?: string}> {
        try {
            await this.m_db!.run(`delete from blocks where number > ${num}`);
        } catch (e) {
            this.m_logger.info(`HostChainContext, _revertToBlock failed e=${e}`);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }

        for (let [name, e] of this.m_elementList) {
            let err = await e.revertToBlock(num);
            if (err) {
                return {err, failedName: name};
            }
        }

        return {err: ErrorCode.RESULT_OK};
    }

    protected async _findRevertPoint(from: { number: number, hash: string }): Promise<{ err: ErrorCode, number?: number }> {
        let latest = from;
        while (true) {
            let _ghr = await this.m_chain.getHeader(latest.number);
            if (_ghr.err) {
                return {err: _ghr.err};
            }

            if (_ghr.header!.hash === latest.hash) {
                return {err: ErrorCode.RESULT_OK, number: latest.number};
            }

            let bl = await this._getBlockByNumber(latest.number - 1);
            if (bl.err) {
                return {err: bl.err};
            }

            latest = bl.latest!;
        }
    }

    protected async _addBlock(header: BlockHeader) {
        if (this.m_syncing) {
            return;
        }
        this.m_syncing = true;
        this.m_logger.info(`HostChainContext, _addBlock begin sync`);
        do {
            const lbr = await this._getLatestBlock();
            if (lbr.err && lbr.err !== ErrorCode.RESULT_NOT_FOUND) {
                this.m_logger.error(`HostChainContext, _addBlock failed for get latest block from storage ${stringifyErrorCode(lbr.err)}`);
                break;
            }

            let beginAddNumber = -1;
            if (lbr.err !== ErrorCode.RESULT_NOT_FOUND) {
                if (lbr.latest!.hash === header.hash) {
                    this.m_logger.info(`HostChainContext, _addBlock ignored for no more block`);
                    break;
                }
                let frp = await this._findRevertPoint(lbr.latest!);
                if (frp.err) {
                    this.m_logger.error(`HostChainContext, _addBlock failed for find revert point failed ${stringifyErrorCode(lbr.err)}`);
                    break;
                }
                beginAddNumber = frp.number!;
            }

            await this._beginTranscation();
            if (beginAddNumber > 0 && beginAddNumber !== lbr.latest!.number) {
                let hr = await this._revertToBlock(beginAddNumber);
                if (hr.err) {
                    this.m_logger.error(`HostChainContext, _addBlock failed for revert block 'to: ${beginAddNumber}' from element '${hr.failedName!}' failed, err=${stringifyErrorCode(hr.err)}`);
                    await this._rollback();
                    break;
                }
            }
            for (let i = beginAddNumber + 1; i <= header.number; i++) {
                let gh = await this.m_chain.getHeader(i);
                if (gh.err) {
                    this.m_logger.error(`HostChainContext, _addBlock failed for get header (number: ${i}) failed`);
                    await this._rollback();
                    break;
                }
                let block = await this.m_chain.getBlock(gh.header!.hash);
                if (!block) {
                    this.m_logger.error(`HostChainContext, _addBlock failed for get block ${header.hash} failed`);
                    await this._rollback();
                    break;
                }
                this.m_logger.info(`HostChainContext, _addBlock, begin add block ${block.number} ${block.hash}`);
                let hr = await this._addBlockToElements(block);
                if (hr.err) {
                    this.m_logger.error(`HostChainContext, _addBlock failed for add block ${block.hash} to element ${hr.failedName!} failed, err=${stringifyErrorCode(hr.err)}`);
                    await this._rollback();
                    break;
                }
            }
            await this._commit();
        } while (false);

        this.m_logger.info(`HostChainContext, _addBlock finish sync`);
        this.m_syncing = false;
        return ErrorCode.RESULT_OK;
    }

    protected async _beginTranscation() {
        await this.m_db!.run('BEGIN;');
    }

    protected async _commit() {
        await this.m_db!.run('COMMIT;');
    }

    protected async _rollback() {
        await this.m_db!.run('ROLLBACK;');
    }
}