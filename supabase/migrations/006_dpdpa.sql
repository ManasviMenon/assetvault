-- DPDPA compliance additions
-- Run in Supabase SQL Editor

-- Deletion request tracking on families
ALTER TABLE families ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
ALTER TABLE families ADD COLUMN IF NOT EXISTS deletion_cancelled_at timestamptz;

-- Allow clients to insert audit log entries for their own family
-- (previously only service role could write; we now allow direct writes
--  so the data layer can log reads and mutations without a round-trip)
CREATE POLICY "audit_log_insert" ON audit_log
  FOR INSERT WITH CHECK (family_id = get_my_family_id());

-- Allow family members to delete their own reminders
-- (needed when an asset is removed client-side)
CREATE POLICY "reminders_delete" ON reminders
  FOR DELETE USING (family_id = get_my_family_id());

-- Allow members to update their own consent records (for revocation)
CREATE POLICY "consents_update" ON consents
  FOR UPDATE USING (member_id = (SELECT auth.uid()));
