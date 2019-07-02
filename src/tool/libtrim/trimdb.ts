import { CUDataBase, IfCUDataBaseOptions } from "./cudatabase";
import winston = require("winston");
import { IFeedBack, ErrorCode } from "../../core";

export interface IfBestItem {
    height: number;
    hash: string;
    timestamp: number;
}
export interface IfHeadersItem {
    hash: string;
    pre: string;
    verified: number;
    raw: Buffer;
}
export interface IfMinersItem {
    hash: string;
    miners: string;
    irbhash: string;
    irbheight: number;
}
export class TrimDataBase extends CUDataBase {
    constructor(logger: winston.LoggerInstance, options: IfCUDataBaseOptions) {
        super(logger, options);
    }
    public async init(): Promise<IFeedBack> {

        return { err: ErrorCode.RESULT_OK, data: null };
    }
}