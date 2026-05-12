-- Добавляем поле slug в таблицу meeting_types
ALTER TABLE meeting_types ADD COLUMN IF NOT EXISTS slug VARCHAR(120);

-- Уникальность slug в рамках одного пользователя
-- (один и тот же slug может быть у разных коучей, но не у одного и того же)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_types_user_slug 
ON meeting_types(user_id, slug) 
WHERE slug IS NOT NULL;

-- Индекс для быстрого поиска услуги по slug
CREATE INDEX IF NOT EXISTS idx_meeting_types_slug 
ON meeting_types(slug) 
WHERE slug IS NOT NULL;