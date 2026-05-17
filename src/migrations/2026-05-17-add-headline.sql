-- Добавляем поле headline (специализация / "чем занимается")
-- Идемпотентно: миграции применяются при каждом старте без трекера.
ALTER TABLE users ADD COLUMN IF NOT EXISTS headline VARCHAR(120);