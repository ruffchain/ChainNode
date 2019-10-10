// copy from https://github.com/ethereum/web3.js/blob/5eab09ddf34abfa2ef77b8e558855dfcb640b723/packages/web3-eth-accounts/src/models/Account.js#L138
const scrypt = require('scrypt.js')
const randomBytes = require('randombytes')
const pbkdf2Sync = require('pbkdf2').pbkdf2Sync
//import { createCipheriv, createDecipheriv } from 'browserify-cipher'
const keccak256 = require('web3-utils').keccak256
const uuid = require('uuid')

const cipher = require('browserify-cipher')
const createCipheriv = cipher.createCipheriv
const createDecipheriv = cipher.createDecipheriv

module.exports.toV3Keystore = (privateKey, address, password, options) => {
  options = options || {}
  const salt = options.salt || randomBytes(32)
  const iv = options.iv || randomBytes(16)

  let derivedKey
  const kdf = options.kdf || 'scrypt'
  const kdfparams = {
    dklen: options.dklen || 32,
    salt: salt.toString('hex')
  }

  if (kdf === 'pbkdf2') {
    kdfparams.c = options.c || 262144
    kdfparams.prf = 'hmac-sha256'
    derivedKey = pbkdf2Sync(
      Buffer.from(password),
      salt,
      kdfparams.c,
      kdfparams.dklen,
      'sha256'
    )
  } else if (kdf === 'scrypt') {
    // FIXME: support progress reporting callback
    kdfparams.n = options.n || 8192 // 2048 4096 8192 16384
    kdfparams.r = options.r || 8
    kdfparams.p = options.p || 1
    derivedKey = scrypt(
      Buffer.from(password),
      salt,
      kdfparams.n,
      kdfparams.r,
      kdfparams.p,
      kdfparams.dklen
    )
  } else {
    throw new Error('Unsupported kdf')
  }

  const cipher = createCipheriv(
    options.cipher || 'aes-128-ctr',
    derivedKey.slice(0, 16),
    iv
  )
  if (!cipher) {
    throw new Error('Unsupported cipher')
  }

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey.replace('0x', ''), 'hex')),
    cipher.final()
  ])

  const mac = keccak256(
    Buffer.concat([derivedKey.slice(16, 32), Buffer.from(ciphertext, 'hex')])
  ).replace('0x', '')

  return {
    version: 3,
    id: uuid.v4({ random: options.uuid || randomBytes(16) }),
    address: address.replace('0x', ''),
    crypto: {
      ciphertext: ciphertext.toString('hex'),
      cipherparams: {
        iv: iv.toString('hex')
      },
      cipher: options.cipher || 'aes-128-ctr',
      kdf,
      kdfparams,
      mac: mac.toString('hex')
    }
  }
}

module.exports.fromV3Keystore = (v3Keystore, password, nonStrict = false) => {
  if (!password) {
    throw new Error('No password given.')
  }

  const json =
    typeof v3Keystore === 'string'
      ? JSON.parse(nonStrict ? v3Keystore.toLowerCase() : v3Keystore)
      : v3Keystore

  if (json.version !== 3) {
    throw new Error('Not a valid V3 wallet')
  }

  let derivedKey
  let kdfparams
  if (json.crypto.kdf === 'scrypt') {
    kdfparams = json.crypto.kdfparams

    // FIXME: support progress reporting callback
    derivedKey = scrypt(
      Buffer.from(password),
      Buffer.from(kdfparams.salt, 'hex'),
      kdfparams.n,
      kdfparams.r,
      kdfparams.p,
      kdfparams.dklen
    )
  } else if (json.crypto.kdf === 'pbkdf2') {
    kdfparams = json.crypto.kdfparams

    if (kdfparams.prf !== 'hmac-sha256') {
      throw new Error('Unsupported parameters to PBKDF2')
    }

    derivedKey = pbkdf2Sync(
      Buffer.from(password),
      Buffer.from(kdfparams.salt, 'hex'),
      kdfparams.c,
      kdfparams.dklen,
      'sha256'
    )
  } else {
    throw new Error('Unsupported key derivation scheme')
  }

  const ciphertext = Buffer.from(json.crypto.ciphertext, 'hex')

  const mac = keccak256(
    Buffer.concat([derivedKey.slice(16, 32), ciphertext])
  ).replace('0x', '')
  if (mac !== json.crypto.mac) {
    throw new Error('Key derivation failed - possibly wrong password')
  }

  const decipher = createDecipheriv(
    json.crypto.cipher,
    derivedKey.slice(0, 16),
    Buffer.from(json.crypto.cipherparams.iv, 'hex')
  )
  const privateKey = `${Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('hex')}`

  return privateKey
}
