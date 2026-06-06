/// <reference types="vitest/globals" />

import {
  deriveMasterKey,
  generatePwhashSalt,
  encryptRecord,
  decryptRecord,
  generateFamilyKey,
  generateMemberKeypair,
  wrapKeyForMember,
  unwrapFamilyKey,
  generateBackupPhrase,
  recoverFromBackupPhrase,
  createSealedRecoveryEnvelope,
  openSealedRecoveryEnvelope,
  deriveKeypairFromMasterKey,
  searchHash,
  toBase64,
} from './index'

// KDF (Argon2id) is intentionally slow — allow generous timeout.
const KDF_TIMEOUT = 15_000

describe('deriveMasterKey', () => {
  it('returns a 32-byte key', async () => {
    const salt = await generatePwhashSalt()
    const key = await deriveMasterKey('test-passphrase', salt)
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.byteLength).toBe(32)
  }, KDF_TIMEOUT)

  it('is deterministic — same passphrase + salt → same key', async () => {
    const salt = await generatePwhashSalt()
    const k1 = await deriveMasterKey('correct-horse-battery', salt)
    const k2 = await deriveMasterKey('correct-horse-battery', salt)
    expect(toBase64(k1)).toBe(toBase64(k2))
  }, KDF_TIMEOUT)

  it('different passphrase → different key', async () => {
    const salt = await generatePwhashSalt()
    const k1 = await deriveMasterKey('passphrase-A', salt)
    const k2 = await deriveMasterKey('passphrase-B', salt)
    expect(toBase64(k1)).not.toBe(toBase64(k2))
  }, KDF_TIMEOUT)

  it('different salt → different key', async () => {
    const s1 = await generatePwhashSalt()
    const s2 = await generatePwhashSalt()
    const k1 = await deriveMasterKey('same-passphrase', s1)
    const k2 = await deriveMasterKey('same-passphrase', s2)
    expect(toBase64(k1)).not.toBe(toBase64(k2))
  }, KDF_TIMEOUT)
})

describe('encryptRecord / decryptRecord', () => {
  it('round-trips a flat object', async () => {
    const key = await generateFamilyKey()
    const data = { bank: 'HDFC', account: '12345678', balance: 50000 }
    const enc = await encryptRecord(data, key)
    const dec = await decryptRecord<typeof data>(enc, key)
    expect(dec).toEqual(data)
  })

  it('round-trips nested objects and arrays', async () => {
    const key = await generateFamilyKey()
    const data = { nominees: ['Alice', 'Bob'], meta: { type: 'fd', rate: 6.5 } }
    const enc = await encryptRecord(data, key)
    const dec = await decryptRecord<typeof data>(enc, key)
    expect(dec).toEqual(data)
  })

  it('produces different ciphertext each call (random nonce)', async () => {
    const key = await generateFamilyKey()
    const e1 = await encryptRecord({ value: 'same' }, key)
    const e2 = await encryptRecord({ value: 'same' }, key)
    expect(e1.ciphertext).not.toBe(e2.ciphertext)
    expect(e1.nonce).not.toBe(e2.nonce)
  })

  it('throws when decrypting with the wrong key', async () => {
    const k1 = await generateFamilyKey()
    const k2 = await generateFamilyKey()
    const enc = await encryptRecord({ secret: 'private' }, k1)
    await expect(decryptRecord(enc, k2)).rejects.toThrow()
  })

  it('throws when ciphertext is tampered', async () => {
    const key = await generateFamilyKey()
    const enc = await encryptRecord({ value: 'original' }, key)
    const tampered = {
      ...enc,
      ciphertext: enc.ciphertext.slice(0, -4) + 'ZZZZ',
    }
    await expect(decryptRecord(tampered, key)).rejects.toThrow()
  })
})

describe('generateFamilyKey', () => {
  it('returns a 32-byte Uint8Array', async () => {
    const key = await generateFamilyKey()
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.byteLength).toBe(32)
  })

  it('generates a unique key each call', async () => {
    const k1 = await generateFamilyKey()
    const k2 = await generateFamilyKey()
    expect(toBase64(k1)).not.toBe(toBase64(k2))
  })
})

describe('wrapKeyForMember / unwrapFamilyKey', () => {
  it('round-trips the family key through a sealed box', async () => {
    const familyKey = await generateFamilyKey()
    const kp = await generateMemberKeypair()
    const wrapped = await wrapKeyForMember(familyKey, kp.publicKey)
    const unwrapped = await unwrapFamilyKey(wrapped, kp.publicKey, kp.privateKey)
    expect(toBase64(unwrapped)).toBe(toBase64(familyKey))
  })

  it('fails to unwrap with the wrong private key', async () => {
    const familyKey = await generateFamilyKey()
    const kp1 = await generateMemberKeypair()
    const kp2 = await generateMemberKeypair()
    const wrapped = await wrapKeyForMember(familyKey, kp1.publicKey)
    await expect(
      unwrapFamilyKey(wrapped, kp1.publicKey, kp2.privateKey)
    ).rejects.toThrow()
  })
})

describe('generateBackupPhrase / recoverFromBackupPhrase', () => {
  it('generates a 24-word phrase', async () => {
    const { phrase } = await generateBackupPhrase()
    expect(phrase.trim().split(/\s+/)).toHaveLength(24)
  })

  it('recovery key round-trips through the phrase', async () => {
    const { phrase, recoveryKey } = await generateBackupPhrase()
    const recovered = await recoverFromBackupPhrase(phrase)
    expect(toBase64(recovered)).toBe(toBase64(recoveryKey))
  })

  it('different calls produce different phrases', async () => {
    const { phrase: p1 } = await generateBackupPhrase()
    const { phrase: p2 } = await generateBackupPhrase()
    expect(p1).not.toBe(p2)
  })

  it('throws on a phrase with words not in the BIP-39 wordlist', async () => {
    await expect(
      recoverFromBackupPhrase('foo bar baz')
    ).rejects.toThrow()
  })
})

describe('createSealedRecoveryEnvelope / openSealedRecoveryEnvelope', () => {
  it('round-trips the family key', async () => {
    const familyKey = await generateFamilyKey()
    const secret = await generateFamilyKey()
    const envelope = await createSealedRecoveryEnvelope(familyKey, secret)
    const recovered = await openSealedRecoveryEnvelope(envelope, secret)
    expect(toBase64(recovered)).toBe(toBase64(familyKey))
  })

  it('fails to open with the wrong secret', async () => {
    const familyKey = await generateFamilyKey()
    const secret1 = await generateFamilyKey()
    const secret2 = await generateFamilyKey()
    const envelope = await createSealedRecoveryEnvelope(familyKey, secret1)
    await expect(
      openSealedRecoveryEnvelope(envelope, secret2)
    ).rejects.toThrow()
  })
})

describe('deriveKeypairFromMasterKey', () => {
  it('is deterministic — same master key → same keypair', async () => {
    const salt = await generatePwhashSalt()
    const masterKey = await deriveMasterKey('test-pass', salt)
    const kp1 = await deriveKeypairFromMasterKey(masterKey)
    const kp2 = await deriveKeypairFromMasterKey(masterKey)
    expect(kp1.publicKey).toBe(kp2.publicKey)
    expect(toBase64(kp1.privateKey)).toBe(toBase64(kp2.privateKey))
  }, 15_000)

  it('different master key → different keypair', async () => {
    const salt = await generatePwhashSalt()
    const mk1 = await deriveMasterKey('pass-one', salt)
    const mk2 = await deriveMasterKey('pass-two', salt)
    const kp1 = await deriveKeypairFromMasterKey(mk1)
    const kp2 = await deriveKeypairFromMasterKey(mk2)
    expect(kp1.publicKey).not.toBe(kp2.publicKey)
  }, 15_000)

  it('derived keypair can wrap and unwrap the family key', async () => {
    const salt = await generatePwhashSalt()
    const masterKey = await deriveMasterKey('test-pass', salt)
    const { publicKey, privateKey } = await deriveKeypairFromMasterKey(masterKey)
    const familyKey = await generateFamilyKey()
    const wrapped = await wrapKeyForMember(familyKey, publicKey)
    const unwrapped = await unwrapFamilyKey(wrapped, publicKey, toBase64(privateKey))
    expect(toBase64(unwrapped)).toBe(toBase64(familyKey))
  }, 15_000)
})

describe('searchHash', () => {
  it('is deterministic for the same input and key', async () => {
    const key = await generateFamilyKey()
    const h1 = await searchHash('HDFC1234', key)
    const h2 = await searchHash('HDFC1234', key)
    expect(h1).toBe(h2)
  })

  it('is case-insensitive', async () => {
    const key = await generateFamilyKey()
    const h1 = await searchHash('HDFC1234', key)
    const h2 = await searchHash('hdfc1234', key)
    expect(h1).toBe(h2)
  })

  it('ignores leading and trailing whitespace', async () => {
    const key = await generateFamilyKey()
    const h1 = await searchHash('HDFC1234', key)
    const h2 = await searchHash('  HDFC1234  ', key)
    expect(h1).toBe(h2)
  })

  it('differs for different inputs', async () => {
    const key = await generateFamilyKey()
    const h1 = await searchHash('HDFC1234', key)
    const h2 = await searchHash('ICICI5678', key)
    expect(h1).not.toBe(h2)
  })

  it('differs for different keys with the same plaintext', async () => {
    const k1 = await generateFamilyKey()
    const k2 = await generateFamilyKey()
    const h1 = await searchHash('same-text', k1)
    const h2 = await searchHash('same-text', k2)
    expect(h1).not.toBe(h2)
  })

  it('returns a base64url string (no +, /, or = characters)', async () => {
    const key = await generateFamilyKey()
    const hash = await searchHash('test-value', key)
    expect(typeof hash).toBe('string')
    expect(hash).not.toMatch(/[+/=]/)
  })
})
