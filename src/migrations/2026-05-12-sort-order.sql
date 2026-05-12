ALTER TABLE meeting_types ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_meeting_types_sort_order ON meeting_types(user_id, sort_order);