ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS expired_notified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS pending_reminder_sent_at TIMESTAMP;