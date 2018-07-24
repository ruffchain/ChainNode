import { ErrorCode } from '../error_code';
import { GlobalConfig } from './global_config';
import * as BaseChain from './chain';
import * as path from 'path';
import * as fs from 'fs-extra';

export class ChainCreator {
    public async createGenesis(chainParam: Map<string, any>, chainType: new () => BaseChain.Chain): Promise<{ err: ErrorCode, chain?: BaseChain.Chain }> {
        let param: any = ['dataDir', 'handler'];
        for (let p of param) {
            if (!chainParam.has(p)) {
                return {err: ErrorCode.RESULT_INVALID_PARAM};
            }
        }
        
        let logOptions: any = {};
        logOptions.loggerOptions = {
            console: true, 
            level: 'debug', 
            file: {root: path.join(chainParam.get('dataDir'), 'log')}
        };
        let c: BaseChain.Chain = new chainType();

        let options: BaseChain.GenesisOptions = {
            dataDir: chainParam.get('dataDir'),
            handler: chainParam.get('handler'),
            loggerOptions: logOptions.loggerOptions
        };

        let err = await c.initComponents(options);
        if (err) {
            return {err};
        }

        return {err: ErrorCode.RESULT_OK, chain: c};
    }

    public async createChain(chainParam: Map<string, any>, chainType: new () => BaseChain.Chain): Promise<{err: ErrorCode, chain?: BaseChain.Chain}> {
        let param = ['dataDir', 'handler', 'node'];
        for (let p of param) {
            if (!chainParam.has(p)) {
                return {err: ErrorCode.RESULT_INVALID_PARAM};
            }
        }

        if (chainParam.has('forceClean') || !fs.pathExistsSync(chainParam.get('dataDir'))) {
            let genesis = chainParam.get('genesis');
            if (!genesis) {
                return {err: ErrorCode.RESULT_INVALID_PARAM};
            }
            await fs.emptyDir(chainParam.get('dataDir'));
            await fs.copy(genesis, chainParam.get('dataDir'));
        }

        let logOptions: any = {};
        logOptions.loggerOptions = {
            console: true, 
            level: 'debug', 
            file: {root: path.join(chainParam.get('dataDir'), 'log')}
        };

        let options: BaseChain.ChainOptions = {
            dataDir: chainParam.get('dataDir'),
            handler: chainParam.get('handler'),
            node: chainParam.get('node'),
            loggerOptions: logOptions.loggerOptions
        };

        options.initBlockWnd = chainParam.get('initBlockWnd');
        options.blockTimeout = chainParam.get('blockTimeout');
        options.headersTimeout = chainParam.get('headersTimeout');
        options.minOutbound = chainParam.get('minOutbound');
        options.nodeCacheSize = chainParam.get('nodeCacheSize');
        options.initializePeerCount = chainParam.get('initializePeerCount');
        options.headerReqLimit = chainParam.get('headerReqLimit');
        options.confirmDepth = chainParam.get('confirmDepth');

        let c: BaseChain.Chain = new chainType();
        
        let err = await c.initialize(options);
        if (err) {
            return {err};
        }

        return {err: ErrorCode.RESULT_OK, chain: c};
    }
}