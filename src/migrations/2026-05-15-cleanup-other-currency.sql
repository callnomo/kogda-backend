-- Чистка устаревшего кода 'OTHER' который остался с прошлой версии валюты.
-- Заменяем на USD по умолчанию.

UPDATE users SET default_currency = 'USD' WHERE default_currency = 'OTHER' OR default_currency IS NULL;
UPDATE meeting_types SET currency = 'USD' WHERE currency = 'OTHER' OR currency IS NULL;