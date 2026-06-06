-- Make phone_e164 nullable to support email-based auth during development.
-- When MSG91 is wired up, phone will be populated on signup.
ALTER TABLE members ALTER COLUMN phone_e164 DROP NOT NULL;
