-- =============================================================================
-- Virasat — initial schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: get the current user's family_id without hitting RLS recursion.
-- SECURITY DEFINER means it runs as the function owner (postgres), so it can
-- read the members table even before the caller's own RLS policy is satisfied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_family_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT family_id FROM members WHERE id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Helper: update updated_at automatically on any UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- TABLES
-- =============================================================================

-- families --------------------------------------------------------------------
CREATE TABLE families (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_tier        text NOT NULL DEFAULT 'free'
                     CHECK (plan_tier IN ('free', 'family')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  dpdp_consent_version text
);

-- members ---------------------------------------------------------------------
-- id = auth.users.id so RLS can use auth.uid() directly.
CREATE TABLE members (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  phone_e164   text NOT NULL,
  email        text,
  role         text NOT NULL
                 CHECK (role IN ('owner', 'co_owner', 'trusted_contact', 'heir')),
  public_key   text,          -- base64url X25519 public key for key wrapping
  pwhash_salt  text,          -- base64url Argon2id salt; stored so server can
                              --   return it on login without the user needing
                              --   to remember it separately
  kyc_status   text NOT NULL DEFAULT 'none',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- member_keys -----------------------------------------------------------------
CREATE TABLE member_keys (
  member_id          uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  wrapped_family_key text NOT NULL,   -- family key sealed for this member
  recovery_method    text NOT NULL DEFAULT 'backup_phrase'
);

-- assets ----------------------------------------------------------------------
CREATE TABLE assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  type           text NOT NULL
                   CHECK (type IN (
                     'bank_account','fixed_deposit','mutual_fund','insurance',
                     'property_urban','locker','loan_taken','other'
                   )),
  encrypted_blob text NOT NULL,   -- JSON {ciphertext, nonce} — opaque to server
  search_hash    text,            -- keyed BLAKE2b for client-side search
  est_value_bucket text,          -- coarse bracket for net-worth estimate
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','dormant','closed')),
  created_by     uuid REFERENCES members(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- asset_nominees --------------------------------------------------------------
CREATE TABLE asset_nominees (
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  percentage    int  CHECK (percentage >= 0 AND percentage <= 100),
  is_legal_heir bool NOT NULL DEFAULT false,
  PRIMARY KEY (asset_id, member_id)
);

-- documents -------------------------------------------------------------------
CREATE TABLE documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  r2_key            text NOT NULL,             -- object key in R2 bucket
  encrypted_doc_key text NOT NULL,             -- per-doc key wrapped with family key
  mime              text NOT NULL,
  size_bytes        int  NOT NULL,
  sha256            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- reminders -------------------------------------------------------------------
CREATE TABLE reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  asset_id    uuid REFERENCES assets(id) ON DELETE CASCADE,
  type        text NOT NULL
                CHECK (type IN ('fd_maturity','premium_due','emi','doc_expiry')),
  due_date    date NOT NULL,
  notified_60 bool NOT NULL DEFAULT false,
  notified_30 bool NOT NULL DEFAULT false,
  notified_7  bool NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- triggers --------------------------------------------------------------------
CREATE TABLE triggers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('death','deadmans_switch')),
  state            text NOT NULL DEFAULT 'armed'
                     CHECK (state IN (
                       'armed','triggered','contesting',
                       'released','dismissed','cancelled'
                     )),
  evidence_ref     text,           -- R2 key of death certificate etc.
  contest_deadline timestamptz,
  initiated_by     uuid REFERENCES members(id),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- audit_log -------------------------------------------------------------------
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES members(id),
  action      text NOT NULL,   -- 'read' | 'create' | 'update' | 'delete' | 'trigger_*'
  target_type text,
  target_id   uuid,
  ts          timestamptz NOT NULL DEFAULT now()
);

-- consents --------------------------------------------------------------------
CREATE TABLE consents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  scope      text NOT NULL,
  version    text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- subscriptions ---------------------------------------------------------------
CREATE TABLE subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  plan         text NOT NULL DEFAULT 'free',
  status       text NOT NULL DEFAULT 'active',
  period_end   timestamptz,
  razorpay_ref text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE families      ENABLE ROW LEVEL SECURITY;
ALTER TABLE members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_keys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_nominees ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE triggers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- families: read your own family only ----------------------------------------
CREATE POLICY "families_select" ON families
  FOR SELECT USING (id = get_my_family_id());

-- members: read all members of your family ------------------------------------
CREATE POLICY "members_select" ON members
  FOR SELECT USING (family_id = get_my_family_id());

-- member_keys: only read your own wrapped key ---------------------------------
CREATE POLICY "member_keys_select" ON member_keys
  FOR SELECT USING (member_id = (SELECT auth.uid()));

CREATE POLICY "member_keys_insert" ON member_keys
  FOR INSERT WITH CHECK (member_id = (SELECT auth.uid()));

CREATE POLICY "member_keys_update" ON member_keys
  FOR UPDATE USING (member_id = (SELECT auth.uid()));

-- assets: full CRUD within your family ----------------------------------------
CREATE POLICY "assets_select" ON assets
  FOR SELECT USING (family_id = get_my_family_id());

CREATE POLICY "assets_insert" ON assets
  FOR INSERT WITH CHECK (family_id = get_my_family_id());

CREATE POLICY "assets_update" ON assets
  FOR UPDATE USING (family_id = get_my_family_id());

CREATE POLICY "assets_delete" ON assets
  FOR DELETE USING (family_id = get_my_family_id());

-- asset_nominees: via asset family membership ---------------------------------
CREATE POLICY "asset_nominees_select" ON asset_nominees
  FOR SELECT USING (
    asset_id IN (SELECT id FROM assets WHERE family_id = get_my_family_id())
  );

CREATE POLICY "asset_nominees_insert" ON asset_nominees
  FOR INSERT WITH CHECK (
    asset_id IN (SELECT id FROM assets WHERE family_id = get_my_family_id())
  );

CREATE POLICY "asset_nominees_delete" ON asset_nominees
  FOR DELETE USING (
    asset_id IN (SELECT id FROM assets WHERE family_id = get_my_family_id())
  );

-- documents: via asset family membership --------------------------------------
CREATE POLICY "documents_select" ON documents
  FOR SELECT USING (
    asset_id IN (SELECT id FROM assets WHERE family_id = get_my_family_id())
  );

CREATE POLICY "documents_insert" ON documents
  FOR INSERT WITH CHECK (
    asset_id IN (SELECT id FROM assets WHERE family_id = get_my_family_id())
  );

CREATE POLICY "documents_delete" ON documents
  FOR DELETE USING (
    asset_id IN (SELECT id FROM assets WHERE family_id = get_my_family_id())
  );

-- reminders: read/write within your family ------------------------------------
CREATE POLICY "reminders_select" ON reminders
  FOR SELECT USING (family_id = get_my_family_id());

CREATE POLICY "reminders_insert" ON reminders
  FOR INSERT WITH CHECK (family_id = get_my_family_id());

CREATE POLICY "reminders_update" ON reminders
  FOR UPDATE USING (family_id = get_my_family_id());

-- triggers: read within your family; write via service role only --------------
CREATE POLICY "triggers_select" ON triggers
  FOR SELECT USING (family_id = get_my_family_id());

-- audit_log: read-only for clients; inserts only via service role -------------
CREATE POLICY "audit_log_select" ON audit_log
  FOR SELECT USING (family_id = get_my_family_id());

-- consents: own member only ---------------------------------------------------
CREATE POLICY "consents_select" ON consents
  FOR SELECT USING (member_id = (SELECT auth.uid()));

CREATE POLICY "consents_insert" ON consents
  FOR INSERT WITH CHECK (member_id = (SELECT auth.uid()));

-- subscriptions: read your family's subscription ------------------------------
CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT USING (family_id = get_my_family_id());
