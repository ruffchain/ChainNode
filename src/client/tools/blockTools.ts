import { getHeaderFromHeight } from './headersTool';
import { Block, BlockHeader } from '../../core/chain/block';
import { BlockStorage } from '../../core/chain/block_storage';
import { Transaction } from '../../core/chain/transaction';
import { Transaction as ValueTranscation} from '../../core/value_chain/transaction';

export function valueTransToObj(value: Transaction, obj?: any) {
    obj = transcationToObj(value, obj);
    obj['value'] = (<ValueTranscation>value).value;
    obj['fee'] = (<ValueTranscation>value).fee;
    return obj;
}

export function transcationToObj(value: Transaction, obj?: any) {
    if (!obj) {
        obj = {};
    }
    obj['hash'] = value.hash;
    obj['sender'] = value.address;
    obj['nonce'] = value.nonce;
    obj['method'] = value.method;
    obj['input'] = value.input;
    return obj;
}

export function blockToObj(block:Block, transcationToObjFunc: (value: Transaction, obj?: any) => any = transcationToObj) {
    let info: any = {};
    info['hash'] = block.header.hash;
    info['height'] = block.header.number;
    info['txs'] = [];
    block.content.transactions.forEach((value) => {
        let txinfo = transcationToObjFunc(value);
        info.txs.push(txinfo);
    })
    return info;
}

export async function getBlock(dataDir: string, height: number, headersType: new () => BlockHeader, transactionType: new () => Transaction) {
    let header = await getHeaderFromHeight(dataDir, height, headersType);

    let blockStorage = new BlockStorage({
        path: dataDir,
        blockHeaderType: headersType,
        transactionType: transactionType
    });

    blockStorage.init();

    if (!blockStorage.has(header.hash)) {
        console.log(`error: cannot find ${(isNaN(height)?'latest':height)} block ${header.hash}.`);
        return null;
    }

    return blockStorage.get(header.hash);
}