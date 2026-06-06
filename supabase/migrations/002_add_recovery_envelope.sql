-- Add recovery_envelope to member_keys
-- This stores the family key encrypted with the backup phrase recovery key,
-- allowing account recovery if the user forgets their passphrase.
ALTER TABLE member_keys ADD COLUMN IF NOT EXISTS recovery_envelope text;
