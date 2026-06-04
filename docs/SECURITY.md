# Security Architecture

This document describes the security model for Virasat. It will be published as a
public-facing security page once the product launches.

## Threat model (summary)

- Virasat the company cannot read your data.
- A database breach exposes only ciphertext.
- A compromised device can only access data while the session is active.
- A compromised Virasat employee has no access to family data.

## Encryption

All sensitive asset data is encrypted client-side using libsodium-wrappers before it
touches the server.

- **Symmetric encryption:** XChaCha20-Poly1305
- **Key derivation:** Argon2id (crypto_pwhash, SENSITIVE ops limit, MODERATE mem limit)
- **Asymmetric / key wrapping:** X25519 sealed boxes
- **Search index:** HMAC-SHA512 (truncated), keyed with a sub-key derived from the family key

## Key hierarchy

```
passphrase
  └─ Argon2id (+ salt stored in member_keys) ──▶ master_key (32 bytes, never leaves device)
       └─ decrypt wrapped_family_key ──▶ family_key (32 bytes, never leaves device)
            ├─ encrypts all asset blobs
            ├─ wraps per-document keys
            └─ sealed box wrapped per-member (stored in member_keys)
```

## Data residency

All data is stored in India (Supabase ap-south-1, Cloudflare R2 APAC region).

## Audit log

Every read, write, and delete is logged in the audit_log table with actor, timestamp,
and target. Users can export the full log.

## Trigger security

The death trigger has a mandatory 7-day contest window. Any family member can dispute.
Disputed triggers go to manual review — they are never auto-released.

## Compliance

DPDPA 2023: purpose-bound consent, data export, data deletion (7-day cancellable).
