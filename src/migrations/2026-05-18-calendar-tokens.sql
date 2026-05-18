-- Миграция: токены подключённых календарей коуча (Google сейчас, Apple/Яндекс потом)
-- Хранит OAuth-токены для двусторонней синхронизации календарей.
-- Идемпотентно: миграции применяются при каждом старте без трекера.

CREATE TABLE IF NOT EXISTS calendar_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'google',
  provider_email VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMP,
  calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  -- один аккаунт каждого провайдера на коуча; переподключение перезатирает
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_user_id ON calendar_connections(user_id);