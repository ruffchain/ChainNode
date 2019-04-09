import BigNumber from 'bignumber.js';

export const SYS_TOKEN_PRECISION = 9;
export const NORMAL_TOKEN_PRECISION = 9;
export const BANCOR_TOKEN_PRECISION = 12;
export const MAX_QUERY_NUM = 21;

export const SYS_TOKEN = 'SYS';
const TOKEN_MIN_LEN = 3;
const TOKEN_MAX_LEN = 12;

const REGPAT = /^[A-Z]{1}[0-9A-Z]{2,11}$/g

function isANumber(args: string) {
  // only contain numbers
  let lst = args.split('');

  for (let i = 0; i < lst.length; i++) {
    // this.logger.info('test:', lst[i])
    console.log(parseInt(lst[i]))

    if (isNaN(parseInt(lst[i]))) {
      return false;
    }
  }
  return true;
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

  if (str === SYS_TOKEN) {
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
