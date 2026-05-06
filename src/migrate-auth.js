// Миграция для auth-функций:
// - сброс пароля по email-ссылке
// - отложенное удаление аккаунта (soft delete на 30 дней)
//
// Запустить ОДИН раз после деплоя:
//   node src/migrate-auth.js
//
// Скрипт идемпотентный.

const pool = require('./db')

async function migrate() {
  console.log('Запускаю миграцию auth...')

  try {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
      ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP
    `)
    console.log('OK: reset_token, reset_token_expires')

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS scheduled_delete_at TIMESTAMP
    `)
    console.log('OK: deleted_at, scheduled_delete_at')

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)
      WHERE reset_token IS NOT NULL
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_scheduled_delete ON users(scheduled_delete_at)
      WHERE scheduled_delete_at IS NOT NULL
    `)
    console.log('OK: индексы')

    console.log('Миграция auth завершена')
    process.exit(0)
  } catch (err) {
    console.error('Ошибка миграции:', err)
    process.exit(1)
  }
}

migrate()