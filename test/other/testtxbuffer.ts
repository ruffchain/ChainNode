import { TxBuffer } from "../../src/core/chain/tx_buffer";
import { Logger } from './logger';

const logger = Logger.init({
    path: './data/log/'
});
let buf = new TxBuffer(logger);
buf.start();