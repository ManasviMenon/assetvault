/**
 * Virasat encryption module — the most security-critical code in the repo.
 *
 * Rules:
 *  - Every function is async (libsodium-wrappers loads WASM asynchronously).
 *  - Keys (master key, family key, private keys) NEVER leave this module as
 *    strings that could be accidentally logged. Callers receive Uint8Array or
 *    base64url strings only where explicitly needed for storage.
 *  - No custom cryptography. All primitives are from libsodium-wrappers.
 *  - BIP-39 mnemonic encoding uses @scure/bip39 (audited library).
 */

import _sodium from 'libsodium-wrappers-sumo'
import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

async function getSodium() {
  await _sodium.ready
  return _sodium
}

// ── encoding helpers ──────────────────────────────────────────────────────────

/** Encode bytes as base64url (no padding, URL-safe). */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** Decode a base64url string back to bytes. */
export function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64url'))
}

// ── key derivation (Argon2id) ─────────────────────────────────────────────────

/** Generate a random salt for Argon2id. Store this in member_keys alongside wrapped_family_key. */
export async function generatePwhashSalt(): Promise<Uint8Array> {
  const sodium = await getSodium()
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
}

/**
 * Derive a 32-byte master key from a user passphrase using Argon2id.
 * Uses OPSLIMIT_MODERATE + MEMLIMIT_INTERACTIVE — good security for mobile.
 * This key never leaves the device.
 */
export async function deriveMasterKey(
  passphrase: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const sodium = await getSodium()
  return sodium.crypto_pwhash(
    32,
    passphrase,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )
}

// ── symmetric encryption (XChaCha20-Poly1305) ─────────────────────────────────

export interface EncryptedRecord {
  ciphertext: string // base64url
  nonce: string     // base64url
}

/**
 * Encrypt any JSON-serialisable object with XChaCha20-Poly1305.
 * A fresh random 24-byte nonce is generated per call.
 * Returns { ciphertext, nonce } — both base64url strings safe for DB storage.
 */
export async function encryptRecord(
  plaintext: object,
  key: Uint8Array
): Promise<EncryptedRecord> {
  const sodium = await getSodium()
  const message = new TextEncoder().encode(JSON.stringify(plaintext))
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    message,
    null,
    null,
    nonce,
    key
  )
  return { ciphertext: toBase64(ciphertext), nonce: toBase64(nonce) }
}

/**
 * Decrypt and deserialise an encrypted record.
 * Throws if the key is wrong or the ciphertext has been tampered with.
 */
export async function decryptRecord<T = unknown>(
  encrypted: EncryptedRecord,
  key: Uint8Array
): Promise<T> {
  const sodium = await getSodium()
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    fromBase64(encrypted.ciphertext),
    null,
    fromBase64(encrypted.nonce),
    key
  )
  if (!plaintext) throw new Error('decryptRecord: authentication failed')
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}

// ── family key ────────────────────────────────────────────────────────────────

/** Generate a fresh random 32-byte family key. */
export async function generateFamilyKey(): Promise<Uint8Array> {
  const sodium = await getSodium()
  return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES)
}

// ── asymmetric key wrapping (X25519 sealed boxes) ─────────────────────────────

/** Generate an X25519 keypair for a family member. The private key must never be sent to the server. */
export async function generateMemberKeypair(): Promise<{
  publicKey: string  // base64url — stored in members.public_key
  privateKey: string // base64url — stored locally only, never transmitted
}> {
  const sodium = await getSodium()
  const kp = sodium.crypto_box_keypair()
  return {
    publicKey: toBase64(kp.publicKey),
    privateKey: toBase64(kp.privateKey),
  }
}

/**
 * Encrypt the family key for a specific member's public key.
 * Uses an ephemeral keypair so the ciphertext reveals nothing about the sender.
 * Store the result in member_keys.wrapped_family_key.
 */
export async function wrapKeyForMember(
  familyKey: Uint8Array,
  memberPublicKeyB64: string
): Promise<string> {
  const sodium = await getSodium()
  const wrapped = sodium.crypto_box_seal(familyKey, fromBase64(memberPublicKeyB64))
  return toBase64(wrapped)
}

/**
 * Decrypt a wrapped family key using the member's keypair.
 * Throws if the keypair does not match the one the key was wrapped for.
 */
export async function unwrapFamilyKey(
  wrappedB64: string,
  memberPublicKeyB64: string,
  memberPrivateKeyB64: string
): Promise<Uint8Array> {
  const sodium = await getSodium()
  const opened = sodium.crypto_box_seal_open(
    fromBase64(wrappedB64),
    fromBase64(memberPublicKeyB64),
    fromBase64(memberPrivateKeyB64)
  )
  if (!opened) throw new Error('unwrapFamilyKey: decryption failed')
  return opened
}

// ── deterministic keypair from master key ─────────────────────────────────────

/**
 * Derive an X25519 keypair deterministically from the master key.
 * Same master key → same keypair every time, so we never need to store
 * the private key — it is re-derived on every login from the passphrase.
 * Only the public key is stored on the server (in members.public_key).
 */
export async function deriveKeypairFromMasterKey(masterKey: Uint8Array): Promise<{
  publicKey: string      // base64url — store in members.public_key
  privateKey: Uint8Array // keep in memory only, never store or transmit
}> {
  const sodium = await getSodium()
  const seed = sodium.crypto_generichash(
    sodium.crypto_box_SEEDBYTES,
    masterKey,
    new TextEncoder().encode('virasat-v1-member-keypair')
  )
  const kp = sodium.crypto_box_seed_keypair(seed)
  return { publicKey: toBase64(kp.publicKey), privateKey: kp.privateKey }
}

// ── backup phrase (BIP-39, 24 words = 256 bits) ───────────────────────────────

/**
 * Generate a 24-word BIP-39 recovery phrase that encodes a 32-byte recovery key.
 * The phrase is shown to the user ONCE during setup; they must write it down.
 */
export async function generateBackupPhrase(): Promise<{
  phrase: string
  recoveryKey: Uint8Array
}> {
  const sodium = await getSodium()
  const recoveryKey = sodium.randombytes_buf(32)
  const phrase = entropyToMnemonic(recoveryKey, wordlist)
  return { phrase, recoveryKey }
}

/**
 * Recover the 32-byte recovery key from a 24-word BIP-39 phrase.
 * Throws if any word is not in the BIP-39 English wordlist or checksum fails.
 */
export async function recoverFromBackupPhrase(phrase: string): Promise<Uint8Array> {
  return mnemonicToEntropy(phrase.trim().toLowerCase(), wordlist)
}

// ── sealed recovery envelope (V1 trusted-contact recovery) ───────────────────

/**
 * Encrypt the family key with the trusted contact's secret.
 * Store the resulting envelope on the server. The trusted contact can only
 * open it after a verified trigger fires (they supply their secret then).
 *
 * V1 note: uses symmetric encryption with a shared secret. V2 will upgrade
 * to Shamir shards (2-of-3) without changing the asset encryption layer.
 */
export async function createSealedRecoveryEnvelope(
  familyKey: Uint8Array,
  trustedContactSecret: Uint8Array
): Promise<EncryptedRecord> {
  return encryptRecord({ key: toBase64(familyKey) }, trustedContactSecret)
}

/**
 * Open the sealed recovery envelope using the trusted contact's secret.
 * Returns the decrypted family key.
 */
export async function openSealedRecoveryEnvelope(
  envelope: EncryptedRecord,
  trustedContactSecret: Uint8Array
): Promise<Uint8Array> {
  const { key } = await decryptRecord<{ key: string }>(envelope, trustedContactSecret)
  return fromBase64(key)
}

// ── search hash (keyed BLAKE2b) ───────────────────────────────────────────────

/**
 * Compute a 32-byte keyed BLAKE2b hash for a client-side searchable index.
 * Input is normalised (trimmed, lowercased) before hashing so search is
 * case-insensitive. The server stores only this hash; it cannot reverse it.
 */
export async function searchHash(
  plaintext: string,
  key: Uint8Array
): Promise<string> {
  const sodium = await getSodium()
  const message = new TextEncoder().encode(plaintext.trim().toLowerCase())
  const hash = sodium.crypto_generichash(32, message, key)
  return toBase64(hash)
}
