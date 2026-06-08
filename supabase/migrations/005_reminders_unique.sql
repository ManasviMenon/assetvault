-- Add unique constraint so reminders can be upserted by asset_id + type
-- (one reminder per asset per reminder type)
ALTER TABLE reminders ADD CONSTRAINT reminders_asset_type_unique UNIQUE (asset_id, type);
