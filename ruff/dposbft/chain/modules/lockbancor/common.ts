import { IReadableKeyValue, IReadWritableKeyValue, BigNumber } from '../../../../../src/host';

export async function bLockBancorToken(kv: IReadableKeyValue): Promise<boolean> {
  let rtnType = await kv.get('type');

  console.log('type:', rtnType);

  if (rtnType.err || rtnType.value !== 'lock_bancor_token') {
    console.log('wrong type');
    return false;
  }
  return true;
}

export async function fetchLockBancorTokenBalance(kv: IReadWritableKeyValue, address: string): Promise<BigNumber> {
  let hret = await kv.hgetall(address);
  if (hret.err || hret.value!.length === 0) {
    console.log('It is empty');
    return new BigNumber(0);
  }

  let amountAll = new BigNumber(0);

  for (let p of hret.value!) {
    let dueBlock = p.key;
    let value = p.value;

    if (dueBlock === '0') {
      amountAll = amountAll.plus(value);
    }
  }
  return amountAll;
}


