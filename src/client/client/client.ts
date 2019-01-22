import {EventEmitter} from 'events';
import {HostClient, HostClientOptions} from './rpc';

export type ChainClientOptions = HostClientOptions;

export class ChainClient extends HostClient {
    constructor(options: ChainClientOptions) {
        super(options);
    }

    on(event: 'tipBlock', listener: (block: any) => void): this;
    on(event: 'eventLogs', listener: (blockHash: string, blockNumber: number, eventLogs: any) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this {
        this.m_emitter.on(event, listener);
        this._beginWatchTipBlock();
        return this;
    }
    once(event: 'eventLogs', listener: (logs: any) => void): this;
    once(event: 'tipBlock', listener: (block: any) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this {
        this.m_emitter.once(event, listener);
        this._beginWatchTipBlock();
        return this;
    }

    removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
        this.m_emitter.removeListener(event, listener);
        return this;
    }

    private async _beginWatchTipBlock() {
        if (this.m_tipBlockTimer) {
            return ;
        }
        this.m_tipBlockTimer = setInterval(
            async () => {
                let {err, block, eventLogs} = await this.getBlock({which: 'latest', eventLog: true});
                if (!block) {
                    return;
                }
                if (!this.m_tipBlock || this.m_tipBlock.hash !== block.hash) {
                    this.m_emitter.emit('tipBlock', block);
                }

                if (eventLogs) {
                    if (!this.m_tipBlock || this.m_tipBlock.hash !== block.hash) {
                        this.m_emitter.emit('eventLogs', block.hash, block.number, eventLogs);
                    }
                }

                this.m_tipBlock = block;
                if (!this._getListenerCount()) {
                    clearInterval(this.m_tipBlockTimer!);
                    delete this.m_tipBlockTimer;
                }
                // TODO: set block interval 
            }, 10000
        );
    }

    private _getListenerCount(): number {
        return this.m_emitter.listenerCount('tipBlock') + this.m_emitter.listenerCount('eventLogs');
    }

    private m_tipBlockTimer?: any;
    private m_tipBlock?: any; 
    private m_emitter = new EventEmitter(); 
}