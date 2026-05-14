-- Миграция: смена email с подтверждением кодом
-- Аналог pending_registrations, но для смены email уже существующим юзером

CREATE TABLE IF NOT EXISTS pending_email_changes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  new_email VARCHAR(255) NOT NULL,
  code VARCHAR(6) NOT NULL,
  code_expires_at TIMESTAMP NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_email_changes_expires
ON pending_email_changes(code_expires_at);

CREATE INDEX IF NOT EXISTS idx_pending_email_changes_new_email
ON pending_email_changes(new_email);