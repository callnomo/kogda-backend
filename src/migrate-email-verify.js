// Миграция для Calendly-style регистрации с кодом подтверждения
// Запустить один раз: node src/migrate-email-verify.js
const pool = require('./db')

async function run() {
  try {
    console.log('Создаём таблицу pending_registrations...')

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_registrations (
        email VARCHAR(255) PRIMARY KEY,
        code VARCHAR(6) NOT NULL,
        code_expires_at TIMESTAMP NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_code_expires
      ON pending_registrations(code_expires_at)
    `)

    console.log('✓ Таблица pending_registrations готова')
    console.log('✓ Индекс idx_pending_code_expires готов')
    process.exit(0)
  } catch (err) {
    console.error('Ошибка миграции:', err)
    process.exit(1)
  }
}

run()