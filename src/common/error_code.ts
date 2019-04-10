
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
    RESULT_TX_EXIST = 34,
    RESULT_VER_NOT_SUPPORT = 35,
    RESULT_EXECUTE_ERROR = 36,
    RESULT_VERIFY_NOT_MATCH = 37,
    RESULT_TX_CHECKER_ERROR = 38,
    RESULT_TX_FEE_NOT_ENOUGH = 39,

    RESULT_SKIPPED = 40,
    RESULT_TX_ADD_TOO_FREQUENTLY = 41,

    RESULT_FORK_DETECTED = 50,

    RESULT_USER_DEFINE = 10000,     // 用户定义的错误码从此开始

    // BANCOR_TOTAL_SUPPLY_LIMIT = 10001,
    // Added Yang Jun
    RESULT_WRONG_ARG = 10001,
    RESULT_DB_TABLE_FAILED = 10002,
    RESULT_DB_TABLE_GET_FAILED = 10003,
    RESULT_DB_TABLE_INSERT_FAILED = 10004,
    RESULT_DB_RECORD_EMPTY = 10005,
    RESULT_DB_TABLE_UPDATE_FAILED = 10006,
    RESULT_DB_TABLE_INSERTREPLACE_FAILED = 10007,
    RESULT_READ_RECORD_FAILED = 10008,
    RESULT_QUEUE_OVER_MAXTIMES = 10009,
    RESULT_DB_TABLE_REMOVE_FAILED = 10010,
    RESULT_DB_TABLE_OPEN_FAILED = 10011,

    RESULT_SYNC_BLOCK_FAILED = 11000,
    RESULT_SYNC_BLOCK_RANGE_FAILED = 11001,
    RESULT_SYNC_BLOCK_RANGE_SAVE_FAILED = 11002,

    RESULT_SYNC_TX_UNKNOWN_METHOD = 11100,
    RESULT_SYNC_TX_EXEC2 = 11101,
    RESULT_SYNC_GETBALANCE_FAILED = 11102,
    RESULT_SYNC_GETTOKENBALANCE_FAILED = 11103,

    RESULT_SYNC_PARSE_JSON_QUERY_FAILED = 11201,
    RESULT_SYNC_GETTXSBYADDRESS_FAILED = 11202,
    RESULT_SYNC_GETFORTUNERANKING_PARSING_FAILED = 11203,
    RESULT_SYNC_GETTOKENPRICE_PARSING_FAILED = 11204,

    RESULT_SYNC_GETCANDY_ALREADY_DONE = 11205,
    RESULT_SYNC_GETCANDY_NOT_YET = 11206,
    RESULT_SYNC_GETCANDY_FAILED = 11207,
    RESULT_SYNC_GETCANDY_OK = 11208,
    RESULT_SYNC_GETCANDY_PARSING_FAILED = 11209,
    RESULT_SYNC_GETCANDY_OPERATION_FAILED = 11210,

    RESULT_SYNC_GETLATESTBLOCK_FAILED = 11300,
    RESULT_SYNC_GETBLOCKS_FAILED = 11301,
    RESULT_SYNC_GETTX_FAILED = 11302,
    RESULT_SYNC_GETTXSBYBLOCK_FAILED = 11303,
    RESULT_SYNC_GETTXS_FAILED = 11304,
    RESULT_SYNC_GETTOKENBYADDRESS_FAILED = 11305,
    RESULT_SYNC_GETACCOUNTS_FAILED = 11306,
    RESULT_SYNC_GETACCOUNT_FAILED = 11307,
    RESULT_SYNC_GETTOKEN_FAILED = 11308,
    RESULT_SYNC_GETTOKENINFO_FAILED = 11308,
    RESULT_SYNC_UPDATEBALANCE_BASIC_FAILED = 11309,
    RESULT_SYNC_GETBANCORTOKENINFO_FAILED = 11310,
    RESULT_SYNC_GETCHAINOVERVIEW_FAILED = 11311,

    RESULT_SYNC_BAD_TX = 11400,

    BANCOR_TOTAL_SUPPLY_LIMIT = 12000,

    RESULT_CHECK_ADDRESS_INVALID = 20001,
    RESULT_CHECK_TOKENID_EXIST = 20002,
}

export function stringifyErrorCode(err: ErrorCode): string {
    if (err === ErrorCode.RESULT_OK) {
        return 'ok';
    } else if (err === ErrorCode.RESULT_FAILED) {
        return 'failed';
    } else if (err === ErrorCode.RESULT_WAIT_INIT) {
        return 'wait init';
    } else if (err === ErrorCode.RESULT_ERROR_STATE) {
        return 'error state';
    } else if (err === ErrorCode.RESULT_INVALID_TYPE) {
        return 'invalid type';
    } else if (err === ErrorCode.RESULT_SCRIPT_ERROR) {
        return 'script error';
    } else if (err === ErrorCode.RESULT_NO_IMP) {
        return 'no implemention';
    } else if (err === ErrorCode.RESULT_ALREADY_EXIST) {
        return 'already exists';
    } else if (err === ErrorCode.RESULT_NEED_SYNC) {
        return 'need sync';
    } else if (err === ErrorCode.RESULT_NOT_FOUND) {
        return 'not found';
    } else if (err === ErrorCode.RESULT_EXPIRED) {
        return 'expired';
    } else if (err === ErrorCode.RESULT_INVALID_PARAM) {
        return 'invalid param';
    } else if (err === ErrorCode.RESULT_PARSE_ERROR) {
        return 'parse error';
    } else if (err === ErrorCode.RESULT_REQUEST_ERROR) {
        return 'request error';
    } else if (err === ErrorCode.RESULT_NOT_SUPPORT) {
        return 'not support';
    } else if (err === ErrorCode.RESULT_TIMEOUT) {
        return 'timeout';
    } else if (err === ErrorCode.RESULT_EXCEPTION) {
        return 'exception';
    } else if (err === ErrorCode.RESULT_INVALID_FORMAT) {
        return 'invalid format';
    } else if (err === ErrorCode.RESULT_UNKNOWN_VALUE) {
        return 'unknown value';
    } else if (err === ErrorCode.RESULT_INVALID_TOKEN) {
        return 'invalid token';
    } else if (err === ErrorCode.RESULT_INVALID_SESSION) {
        return 'invalid session';
    } else if (err === ErrorCode.RESULT_OUT_OF_LIMIT) {
        return 'out of limit';
    } else if (err === ErrorCode.RESULT_PERMISSION_DENIED) {
        return 'permission denied';
    } else if (err === ErrorCode.RESULT_OUT_OF_MEMORY) {
        return 'out of memory';
    } else if (err === ErrorCode.RESULT_INVALID_STATE) {
        return 'invalid state';
    } else if (err === ErrorCode.RESULT_NOT_ENOUGH) {
        return 'not enough';
    } else if (err === ErrorCode.RESULT_ERROR_NONCE_IN_TX) {
        return 'transaction nonce error';
    } else if (err === ErrorCode.RESULT_INVALID_BLOCK) {
        return 'invalid block';
    } else if (err === ErrorCode.RESULT_CANCELED) {
        return 'canceled';
    } else if (err === ErrorCode.RESULT_FEE_TOO_SMALL) {
        return 'to small fee';
    } else if (err === ErrorCode.RESULT_READ_ONLY) {
        return 'readonly';
    } else if (err === ErrorCode.RESULT_TX_EXIST) {
        return 'transaction exists';
    } else if (err === ErrorCode.RESULT_VER_NOT_SUPPORT) {
        return 'version not support';
    } else if (err === ErrorCode.RESULT_EXECUTE_ERROR) {
        return 'execute error';
    } else if (err === ErrorCode.RESULT_VERIFY_NOT_MATCH) {
        return 'verify as invalid';
    } else if (err === ErrorCode.RESULT_SKIPPED) {
        return 'skipped';
    } else if (err === ErrorCode.RESULT_FORK_DETECTED) {
        return 'fork detected';
    } else if (err === ErrorCode.RESULT_TX_ADD_TOO_FREQUENTLY) {
        return 'add tx too frequently';
    } else if (err > ErrorCode.RESULT_USER_DEFINE) {
        return `user defined errorcode ${err}`;
    } else {
        return 'unknown';
    }
}
