-- Миграция: верификация устройства при логине + список доверенных устройств

-- Таблица доверенных устройств (TTL 90 дней)
CREATE TABLE IF NOT EXISTS trusted_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token VARCHAR(128) NOT NULL UNIQUE,
  user_agent TEXT,
  device_label VARCHAR(255),
  last_ip VARCHAR(45),
  last_city VARCHAR(255),
  last_country VARCHAR(10),
  last_used_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_id ON trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_token ON trusted_devices(device_token);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires ON trusted_devices(expires_at);

-- Таблица ожидающих верификаций при логине (TTL 10 минут)
-- По user_id PRIMARY KEY — одна попытка на юзера, новая затирает старую
CREATE TABLE IF NOT EXISTS pending_logins (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(6) NOT NULL,
  code_expires_at TIMESTAMP NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- сохраняем контекст устройства чтобы привязать его при успехе
  user_agent TEXT,
  ip VARCHAR(45),
  city VARCHAR(255),
  country VARCHAR(10),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_logins_expires ON pending_logins(code_expires_at);