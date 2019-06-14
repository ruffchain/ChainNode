import BigNumber from 'bignumber.js';
import { IReadableKeyValue, ErrorCode } from '../../../../src/core';
import { IfConfigGlobal } from '../handler';
import * as fs from 'fs';

export const SYS_MORTGAGE_PRECISION = 0;
export const SYS_TOKEN_PRECISION = 9;
export const NORMAL_TOKEN_PRECISION = 9;
export const BANCOR_TOKEN_PRECISION = 12;
export const MAX_QUERY_NUM = 21;

export const VOTE_FROM_DEPOSIT = 6870;


export const SYS_TOKEN = 'SYS';
export const SVT_TOKEN = 'SVT';
const TOKEN_MIN_LEN = 3;
const TOKEN_MAX_LEN = 12;

// transferLockBancorTokenToMulti
export const MAX_TO_MULTI_NUM = 200;

const REGPAT = /^[A-Z]{1}[0-9A-Z]{2,11}$/g;

export interface IfBancorTokenItem {
  amount: string;
  address: string;
  lock_amount: string;
  time_expiration: string;
}
export interface IfRegisterOption {
  name: string;
  ip: string;
  url: string;
  location: string;
}

export function isANumber(amount: string) {
  let bn = new BigNumber(amount);

  if (bn.isNaN() === true) {
    return false;
  }
  let num = JSON.parse(amount);
  return num >= 0;
}

function numNumbers(str: string) {
  let lst = str.split('');
  let counter = 0;

  for (let i = 0; i < lst.length; i++) {
    if (isNaN(parseInt(lst[i]))) {
      counter++;
    }
  }
  return str.length - counter;

}

export function bCheckTokenid(tokenid: string) {
  let str = tokenid.toUpperCase();

  // 3~12位
  if (str.length < TOKEN_MIN_LEN || str.length > TOKEN_MAX_LEN) {
    return false;
  }

  if (str === SYS_TOKEN || str === SVT_TOKEN) {
    return false;
  }
  // 1st not number,
  if (str.match(REGPAT) === null) {
    return false;
  }

  if (numNumbers(str) > 3) {
    return false;
  }

  return true;
}

export function strAmountPrecision(num: string, precision: number): string {
  let nTemp = parseFloat(num);
  return nTemp.toFixed(precision);
}

export function bCheckTokenPrecision(precision: string) {
  let bn = new BigNumber(precision);

  if (bn.isNaN()) {
    return false;
  }

  let num = parseInt(precision);

  return num >= 0 && num <= NORMAL_TOKEN_PRECISION;
}

const DB_REGPAT = /^[A-Z]{1}[0-9A-Z]{2,11}$/g
const DB_NAME_MIN_LEN = 3;
const DB_NAME_MAX_LEN = 12;

export function bCheckDBName(dbName: string) {
  let str = dbName.toUpperCase();

  if (!dbName) {
    return false;
  }
  // 3~12位
  if (str.length < DB_NAME_MIN_LEN || str.length > DB_NAME_MAX_LEN) {
    return false;
  }

  // 1st not number,
  if (str.match(DB_REGPAT) === null) {
    return false;
  }

  return true;
}

export function bCheckMethodName(dbName: string) {
  return bCheckDBName(dbName);
}

export function bCheckRegisterOption(option: IfRegisterOption): boolean {
  if (option.name.length > 20
    || option.ip.length > 50
    || option.url.length > 50
    || option.location.length > 50) {
    return false;
  }

  // check if name is used already
  // 2019-6-11



  return true;
}

export async function getTokenBalance(balanceKv: IReadableKeyValue, address: string): Promise<BigNumber> {
  let retInfo = await balanceKv.get(address);
  return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value : new BigNumber(0);
}

export let configObj: IfConfigGlobal;

export function readConfigFile() {
  // Added by Yang Jun 2019-3-27
  let configBuffer = fs.readFileSync('./dist/blockchain-sdk/ruff/dposbft/chain/config.json');
  try {
    configObj = JSON.parse(configBuffer.toString())
  } catch (e) {
    throw new Error('handler.ts read ./config.json')
  }
}

export function bCheckBancorTokenFactor(factor: string): boolean {
  let bn = new BigNumber(factor);

  if (bn.isNaN() === true) {
    return false;
  }
  return bn.isLessThanOrEqualTo(1) && bn.isGreaterThan(0);
}
