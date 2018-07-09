import {ErrorCode} from '../error_code';
import {IReadableKeyValue, IReadableStorage} from '../storage/storage';
import {BlockHeader} from '../chain/block';
import {BaseHandler, ViewListener} from './handler';
import {Chain} from '../chain/chain';

export type ViewExecutorOptions = {
    header: BlockHeader, 
    storage:IReadableStorage, 
    handler: BaseHandler,
    method: string, 
    param: any,
    externContext: any
};

export class ViewExecutor {
    protected m_handler: BaseHandler;
    protected m_method: string;
    protected m_param: any;
    protected m_externContext: any;
    protected m_header: BlockHeader; 
    protected m_storage:IReadableStorage; 

    constructor(options: ViewExecutorOptions) {
        this.m_handler = options.handler;
        this.m_method = options.method;
        this.m_param = options.param;
        this.m_externContext = options.externContext;
        this.m_header = options.header;
        this.m_storage = options.storage;
    }

    public get externContext():any {
        return this.m_externContext;
    }

    protected async prepareContext(blockHeader: BlockHeader, storage: IReadableStorage, externContext: any): Promise<any> {
        let kv =  (await storage.getReadableKeyValue(Chain.kvUser)).kv!;
        let context = Object.create(externContext);
        // context.getNow = (): number => {
        //     return blockHeader.timestamp;
        // };

        Object.defineProperty(
            context, 'now', {
                writable: false,
                value: blockHeader.timestamp
            } 
        );
        
        // context.getHeight = (): number => {
        //     return blockHeader.number;
        // };

        Object.defineProperty(
            context, 'height', {
                writable: false,
                value: blockHeader.number
            } 
        );

        // context.getStorage = (): IReadWritableKeyValue => {
        //     return kv;
        // }

        Object.defineProperty(
            context, 'storage', {
                writable: false,
                value: kv
            } 
        );
        return context;
    }

    public async execute(): Promise<{err: ErrorCode, value?:any}>  {
        let fcall: ViewListener|undefined =  this.m_handler.getViewMethod(this.m_method);
        if (!fcall) {
            return {err: ErrorCode.RESULT_NOT_SUPPORT};    
        }
        let context = await this.prepareContext(this.m_header, this.m_storage, this.m_externContext);
       
        try {
            let v: any = await fcall(context, this.m_param);
            return {err: ErrorCode.RESULT_OK, value: v};
        } catch (error) {
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
    }
}