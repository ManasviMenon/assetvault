-- Tracks pending family invitations sent by owners
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'heir',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_by uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Only family members can see invitations for their family
CREATE POLICY "family members can view invitations"
  ON invitations FOR SELECT
  USING (family_id = get_my_family_id());

-- Only owners/co-owners can create invitations
CREATE POLICY "owners can create invitations"
  ON invitations FOR INSERT
  WITH CHECK (family_id = get_my_family_id());

-- Only owners/co-owners can delete invitations
CREATE POLICY "owners can delete invitations"
  ON invitations FOR DELETE
  USING (family_id = get_my_family_id());
