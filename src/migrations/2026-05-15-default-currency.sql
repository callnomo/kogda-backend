-- Добавляем default_currency в users (валюта по умолчанию для новых услуг)
-- Дефолт USD: русскоязычные специалисты есть везде, не только в РФ.
-- Юзер может поменять в Настройках → Аккаунт.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_currency VARCHAR(10) DEFAULT 'USD';

-- Для существующих юзеров (у кого NULL после миграции) — ставим USD
UPDATE users SET default_currency = 'USD' WHERE default_currency IS NULL;