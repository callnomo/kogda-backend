-- Добавляем новые поля для услуг (price_mode, location_type, step_minutes, enabled_payments, enabled_banks)

ALTER TABLE meeting_types
  ADD COLUMN IF NOT EXISTS price_mode VARCHAR(20) NOT NULL DEFAULT 'amount';

ALTER TABLE meeting_types
  ADD COLUMN IF NOT EXISTS location_type VARCHAR(20) NOT NULL DEFAULT 'video';

ALTER TABLE meeting_types
  ADD COLUMN IF NOT EXISTS step_minutes INTEGER NOT NULL DEFAULT 30;

ALTER TABLE meeting_types
  ADD COLUMN IF NOT EXISTS enabled_payments JSONB;

ALTER TABLE meeting_types
  ADD COLUMN IF NOT EXISTS enabled_banks JSONB;

-- Бэкфилл price_mode из существующего hide_price
-- Где hide_price = true → price_mode = 'hidden'
UPDATE meeting_types
SET price_mode = 'hidden'
WHERE hide_price = true;