# CLAUDE.md — Virasat project brief

This file is the source of truth for the Virasat project. Read it fully before doing
any work. Keep it updated as decisions are made.

---

## What we are building

Virasat is a family asset management vault — a web app (Next.js, PWA) where an Indian
family actively manages its finances, assets, documents, and important financial dates
together, in one shared, encrypted place. On top of that day-to-day management sits a
protection layer: nominee tracking and a verified mechanism for a trusted contact to
receive access if the owner dies or is incapacitated, so the family's financial picture
is never lost.

POSITIONING IS IMPORTANT — read this carefully, it shapes every screen:

Virasat is PRIMARILY an active, present-tense family asset management product. It is the
place a family keeps the live picture of its wealth — what they own, what it's worth,
what's maturing, what's due, what needs attention. It is opened weekly. People use it
because it is genuinely useful for running their financial life.

The posthumous/incapacitation recovery is a POWERFUL LAYER WITHIN this, not the headline.
It is the deeper reason families stay and trust us, but it is NOT the lead. We do not
sell on death anxiety. We lead with usefulness and reassure on protection.

The synthesis: "the one place your family manages everything — and the one place that
makes sure nothing is ever lost."

The core problems we solve, in order of how we lead with them:
1. Indian families have no single, shared, current view of everything they own across
   many banks, AMCs, insurers, and properties. Virasat is that live picture.
2. Families miss FD maturities, premium due dates, EMIs, and document expiries because
   nothing tracks them in one place. Virasat reminds them.
3. Families aren't organised or protected — no nominees, no documents in one place, no
   continuity plan. Virasat scores this and helps fix it.
4. When the primary decision-maker dies or is incapacitated, the family usually can't
   find anything. Virasat's protection layer guarantees they can.

The active management layer is what gets people in and brings them back. The protection
layer is the moat and the reason they never leave. Never drop the protection layer (it
is what makes us not a commodity money app), but never lead the experience or the
marketing with death.

This is a solo-founder V1 shipped to a closed beta of 50-100 families. Optimise for
shipping a correct, secure, usable product fast and cheap, not for scale.

---

## Critical constraints (do not violate)

1. **Client-side encryption is non-negotiable.** All sensitive family data (asset
   details, documents, notes) must be encrypted on the client before it touches the
   server. The server stores only ciphertext. Virasat must never be able to read user
   data. The user's passphrase and master key must never be transmitted to the server.

2. **Never write custom cryptography.** Use libsodium-wrappers primitives only
   (XChaCha20-Poly1305 for symmetric encryption, crypto_pwhash with Argon2id for key
   derivation, crypto_box / sealed boxes for asymmetric). For Shamir-style sharing in
   later versions use a well-known audited library. If you are ever unsure how to do
   something cryptographic safely, stop and ask rather than inventing.

3. **DPDPA compliance from the start.** Purpose-bound consent capture, data export, data
   deletion, and an audit log are required, not optional. Build them in, do not retrofit.

4. **No investment advice, ever.** The app educates and organises. It must never
   recommend specific investments or imply portfolio actions ("buy X", "you should hold
   more equity"). That requires a SEBI licence we do not have. Educational content is
   curated links to free third-party resources (Zerodha Varsity, SEBI, RBI) only —
   never original financial advice, never reproduced third-party content.

5. **All data stored in India.** Supabase project and R2 bucket in Indian/Asian regions.
   No data leaves India.

6. **This is V1. Build only the V1 feature list below.** If a feature is not on the V1
   list, do not build it. Add it to docs/V2_BACKLOG.md instead.

---

## Tech stack

- **Framework:** Next.js 15, App Router, TypeScript, React Server Components where
  sensible (but encryption/decryption must happen client-side in Client Components).
- **Styling:** Tailwind CSS. Mobile-first. Clean, calm, trustworthy aesthetic.
- **Auth + DB + file metadata:** Supabase (Postgres, Auth, Row Level Security).
- **Phone OTP:** MSG91 (send OTP), Supabase manages the session.
- **Document storage:** Cloudflare R2 (S3-compatible), accessed via signed URLs.
  Files are encrypted client-side before upload.
- **Backend API / background jobs:** Next.js route handlers + Supabase Edge Functions
  for scheduled jobs (reminder checks, trigger contest-window expiry).
- **Email:** Resend.
- **Push notifications:** Web Push (PWA) where supported; email/SMS fallback.
- **Payments:** Razorpay (subscriptions, recurring UPI mandate + cards).
- **Encryption:** libsodium-wrappers (client-side).
- **Error tracking:** Sentry. **Analytics:** PostHog (EU cloud).
- **Hosting:** Vercel.

Do not introduce additional services or heavy dependencies without a clear reason.
Prefer the free tiers of the services above.

---

## Folder structure

```
/app                  Next.js App Router pages and layouts
  /(auth)             login, OTP, passphrase setup
  /(app)              authenticated app
    /home             home: net worth, this-month calendar, score, attention items,
                      asset groups, and a calm "family protected" status section
    /assets           asset list and detail
    /family           members, roles, trusted contact ceremony
    /calendar         visual calendar of financial dates
    /preview          release plan preview
    /settings         account, security, privacy, subscription
  /api                route handlers (signed URLs, razorpay webhooks, msg91, etc.)
/lib
  /crypto             the encryption module (the most important code in the repo)
  /supabase           supabase client setup
  /db                 typed data access layer (all encryption happens here)
  /score              preparedness score logic
  /reminders          reminder detection logic
/components            reusable UI components
/supabase
  /migrations         SQL schema migrations
  /functions          edge functions (scheduled jobs)
/docs
  V2_BACKLOG.md        features explicitly deferred
  SECURITY.md          security architecture, for the public security page later
/public                PWA manifest, icons
CLAUDE.md              this file
.env.local             secrets, never committed
```

---

## Data model (Supabase Postgres)

All sensitive fields live inside an `encrypted_blob` column (ciphertext). Only
non-sensitive indexing metadata is in plaintext columns. Use Row Level Security so a
user can only ever query rows for their own family.

```
families
  id uuid pk
  plan_tier text            -- 'free' | 'family'
  created_at timestamptz
  dpdp_consent_version text

members
  id uuid pk
  family_id uuid fk
  phone_e164 text
  email text
  role text                 -- 'owner' | 'co_owner' | 'trusted_contact' | 'heir'
  public_key text           -- for family-key wrapping
  kyc_status text
  created_at timestamptz

member_keys
  member_id uuid fk
  wrapped_family_key text    -- family key encrypted for this member
  recovery_method text

assets
  id uuid pk
  family_id uuid fk
  type text                  -- see asset types below
  encrypted_blob text        -- all sensitive fields, ciphertext
  search_hash text           -- HMAC for client-side search, not reversible
  est_value_bucket text      -- coarse bucket only, for net-worth estimate, optional
  status text                -- 'active' | 'dormant' | 'closed'
  created_by uuid fk
  created_at timestamptz
  updated_at timestamptz

asset_nominees
  asset_id uuid fk
  member_id uuid fk
  percentage int
  is_legal_heir bool

documents
  id uuid pk
  asset_id uuid fk
  r2_key text                -- key in R2 bucket
  encrypted_doc_key text     -- per-document key, wrapped with family key
  mime text
  size_bytes int
  sha256 text

reminders
  id uuid pk
  family_id uuid fk
  asset_id uuid fk
  type text                  -- 'fd_maturity' | 'premium_due' | 'emi' | 'doc_expiry'
  due_date date
  notified_60 bool
  notified_30 bool
  notified_7 bool

triggers
  id uuid pk
  family_id uuid fk
  type text                  -- 'death' | 'deadmans_switch'
  state text                 -- 'armed' | 'triggered' | 'contesting' | 'released' | 'dismissed'
  evidence_ref text          -- r2 key of death certificate etc
  contest_deadline timestamptz
  initiated_by uuid fk
  resolved_at timestamptz

audit_log
  id uuid pk
  family_id uuid fk
  actor_id uuid fk
  action text                -- 'read' | 'create' | 'update' | 'delete' | 'trigger_*'
  target_type text
  target_id uuid
  ts timestamptz

consents
  id uuid pk
  member_id uuid fk
  scope text
  version text
  granted_at timestamptz
  revoked_at timestamptz

subscriptions
  id uuid pk
  family_id uuid fk
  plan text
  status text
  period_end timestamptz
  razorpay_ref text
```

---

## Asset types and their type-specific fields

All amounts are optional (some users won't fill them). Every asset also gets the
universal fields (nominee, physical_location, notes, status, documents).

- **bank_account:** bank, branch, account_number_masked, ifsc, account_type, joint_holders
- **fixed_deposit:** bank, fd_number, principal, maturity_date, interest_rate, auto_renew, certificate_location
- **mutual_fund:** amc, folio_number, scheme_name, sip_amount, sip_date
- **insurance:** insurer, policy_number, policy_type (life/health/general), sum_assured, premium_amount, premium_due_date, riders
- **property_urban:** address, property_type (flat/plot), area_sqft, ownership_type, society_share_cert_number, registration_number
- **locker:** bank, branch, locker_number, key_holders, last_visited
- **loan_taken:** lender, loan_number, principal, emi_amount, emi_date, end_date, co_borrower
- **other:** title, description, value (all free-form)

Universal fields on every asset:
- nominee: references members, with percentage
- physical_location: free text ("FD certificate in steel almirah top shelf")
- notes: free text
- status: active / dormant / closed

---

## Encryption module spec (lib/crypto)

This is the most important code in the repo. Build it first, test it thoroughly, get
it human-reviewed before building features on top.

Functions required:

- `deriveMasterKey(passphrase, salt)` — Argon2id via crypto_pwhash. Returns a 32-byte
  key. Runs client-side only.
- `encryptRecord(plaintextObject, key)` — serialise to JSON, encrypt with
  XChaCha20-Poly1305, return { ciphertext, nonce }.
- `decryptRecord(ciphertext, nonce, key)` — reverse.
- `generateFamilyKey()` — random 32-byte key.
- `wrapKeyForMember(familyKey, memberPublicKey)` — sealed box so only the member can
  unwrap.
- `unwrapFamilyKey(wrapped, memberKeypair)` — reverse.
- `generateBackupPhrase()` — 24-word BIP-39-style mnemonic that encodes the master key
  recovery secret.
- `recoverFromBackupPhrase(phrase)` — reverse.
- `createSealedRecoveryEnvelope(familyKey, trustedContactSecret)` — the V1 mechanism
  for trusted-contact recovery (the simpler stand-in for Shamir sharding). Produces a
  recovery secret that, combined with a verified trigger, lets the trusted contact
  reconstruct access.
- `searchHash(plaintext, key)` — HMAC for building a client-side searchable index that
  the server cannot reverse.

Every function gets unit tests. The master key and passphrase must never be logged,
serialised to the server, or stored unencrypted anywhere.

V1 note: we are using a sealed recovery envelope rather than full Shamir Secret Sharing
to keep V1 shippable solo. Shamir (2-of-3 shards across Virasat, trusted contact, and a
notary) is a V2 upgrade. Structure the code so it can be swapped without changing the
asset encryption.

---

## Member roles and permissions

| Role            | Add/edit assets | View all | Invite | Manage triggers | Access on trigger |
| owner           | yes             | yes      | yes    | yes             | already has        |
| co_owner        | yes             | yes      | no     | co-sign         | already has        |
| trusted_contact | no              | preview only (types + counts, no values/docs) | no | initiates | full on verified trigger |
| heir            | no              | only their assigned assets | no | no | their assigned assets |

Enforce these in the data access layer AND in Supabase Row Level Security. Never trust
the client alone.

---

## Trigger state machine

States: armed -> triggered -> contesting -> released, plus dismissed and cancelled.

Death trigger:
1. armed (default once a trusted contact is verified)
2. trusted contact initiates -> triggered, uploads death certificate
3. -> contesting: 7-day window, all members notified, any member can dispute
4. if disputed -> manual review (pause); if 7 days clear -> released
5. released: trusted contact can reconstruct access via the sealed recovery envelope

Dead-man's switch:
1. armed (opt-in)
2. monthly check-in push; if no response in 30 days escalate to email+SMS; 60 days
   notify emergency contacts; 90 days -> fires, enters the same contest window
3. owner can respond at any point to reset to armed

A scheduled Supabase Edge Function checks hourly for expired contest windows and
overdue check-ins.

---

## Family financial health score (lib/score)

A 0-100 score on the home screen measuring the OVERALL HEALTH AND ORGANISATION of the
family's financial life. Protection-readiness is one component of this broader picture,
not the whole thing. This reframing matters: the score is about "how healthy and
organised is our family's financial life," which fits the active-management positioning,
NOT "how ready are your heirs," which would over-index on death.

Measures organisational, protective, and structural health. NEVER investment
performance, NEVER advice (no SEBI licence).

Components (suggested weights, tune later):
- asset coverage breadth (variety of asset types logged — how complete is the picture) — 15
- everything current (assets updated recently, values not stale) — 10
- nominee coverage (% of assets with a nominee) — 15
- document completeness (% of assets with physical location or uploaded doc) — 15
- upcoming dates handled (no overdue premiums/EMIs flagged) — 10
- has any term/health insurance logged (presence, not amount) — 10
- trusted contact verified (protection layer) — 10
- recovery envelope distributed (protection layer) — 5
- will reference logged (yes/no) — 5
- emergency buffer flagged (presence of a liquid asset, not amount) — 5

Show progress over time and celebrate increases ("your family's financial health went
from 45 to 70 this month"). No cross-family leaderboards. Suggestions must be
organisational ("add a nominee to your HDFC FD", "your LIC premium is due in 5 days") or
educational (a curated link), NEVER investment advice.

---

## Contextual education

When the score detects a gap, surface a curated link to free, reputable third-party
content. Examples: no mutual funds logged -> link to a Zerodha Varsity intro module;
no will logged -> link to a government/legal explainer on wills and nominees.

Rules: links and short embeds only. Do not reproduce third-party text, scripts, or
videos as our own. Always attribute. No original financial advice. This is a pointer to
education, not a content product (original content is V2).

---

## Subscription tiers

- **free:** up to 5 assets, 1 member, no trusted contact, no triggers.
- **family:** Rs 1499/year, unlimited assets, up to 6 members, full trigger system,
  5 GB document storage.

Upgrade prompts trigger at the 5-asset limit and when the user tries to designate a
trusted contact. Razorpay handles recurring UPI mandate and cards. Do NOT use Apple/
Google in-app purchases (this is web; Razorpay avoids platform cuts).

---

## V1 feature list (build exactly these)

1. Phone OTP signup, passphrase, 24-word backup phrase
2. Family creation, up to 6 members, four roles
3. Asset register, 8 types, universal fields
4. Document upload, client-side encrypted, R2 storage, preview, download
5. DigiLocker OAuth to pull user's own government documents
6. Trusted contact verification ceremony with printable PDF
7. Death trigger with 7-day contest window
8. Dead-man's switch with 90-day escalation
9. Sealed recovery envelope (V1 stand-in for Shamir)
10. Reminder engine (FD maturity, premium, EMI, document expiry)
11. "This month at a glance" home panel
12. Visual calendar view of financial dates
13. Family financial health score with progress celebration
14. Contextual education via curated links
15. Nominee gap surfacing with one-tap fix
16. Release plan preview (the protection layer, presented calmly)
17. Client-side encrypted search
18. Audit log
19. Razorpay subscription (free + family tiers)
20. DPDPA: consent capture, data export, data deletion (7-day cancellable)
21. Settings (passphrase change, sessions, logout-all)
22. English + Hindi localisation
23. PWA (installable, offline viewing, web push where supported)

---

## Explicitly NOT in V1 (put in docs/V2_BACKLOG.md if raised)

Native iOS/Android apps; voice notes + transcription; Marathi/Tamil; full Shamir
sharing; Account Aggregator; MFCentral/NSDL auto-fetch; unclaimed money finder; document
OCR auto-fill; concierge claims; memory vault; expense tracking; insurance gap analysis;
tax-event tracker; NRI corridor; multi-currency; B2B advisor API; original educational
video production; cross-family comparison/leaderboards.

---

## Home screen hierarchy (reflects the positioning)

The home screen must lead with active management and present protection as a calm,
reassuring section — NOT the headline. Build it in this order top to bottom:

1. Greeting + family name.
2. Family net worth (estimated), with a small "X assets, updated Y days ago".
3. "This month" — the upcoming financial calendar items (FD maturing, premium due, EMI,
   document expiring). This is the daily-utility hook; give it prominence.
4. Family financial health score, with this-month progress.
5. "Needs your attention" — nominee gaps, stale assets, overdue items, each one-tap fix.
6. Asset groups (Banks, Investments, Insurance, Property & Locker, Loans).
7. A calm "Your family is protected" status section at the bottom: trusted contact
   verified, release plan ready. Reassuring, present, but not the lead. If protection
   is NOT set up, this becomes a gentle prompt ("Set up your trusted contact so your
   family is never locked out") — still calm, never fear-based.

The emotional arc of the home screen: "here's your money, here's what's coming up,
here's how you're doing, here's what to tidy up — and rest assured, your family is
covered." Management first, protection as the reassuring foundation.

---

## Design and tone

- Calm, trustworthy, uncluttered. This product handles people's life savings — and,
  quietly, their mortality. Never flippant, never aggressive, never hype, never
  fear-selling.
- LEAD WITH USEFULNESS, REASSURE ON PROTECTION. The dominant feeling should be "this is
  the place I manage my family's money and it's genuinely useful," with protection as a
  calm undercurrent of "and we've got you covered if the worst happens." Never make
  death or loss the emotional lead of any screen or any marketing copy.
- Mobile-first. Most users are on Android phones; the experience must be excellent at
  ~380px wide. Desktop is a bonus for bulk data entry.
- Minimal formatting, generous whitespace, clear typography.
- Use rupees (Rs / INR) everywhere, Indian number formatting (lakhs, crores).
- Copy is warm, plain, and reassuring. Avoid jargon. A 55-year-old non-technical parent
  should understand every screen.
- Status language is specific and calm: "Trusted contact verified. Your family can
  reach everything if needed." not "You're all set!" and not "Prepare for death."

---

## Working agreement with the founder

- Build in vertical slices, one feature end-to-end at a time.
- After each working slice, stop so the founder can test and commit.
- Write tests for the crypto module and the data access layer.
- Never commit secrets. Keep .env.local in .gitignore.
- If asked to build something not in the V1 list, flag it and suggest adding it to the
  V2 backlog instead.
- When a cryptographic or security decision comes up, explain the options and the
  recommended choice rather than silently picking one.
- Keep this CLAUDE.md updated as decisions are made.
