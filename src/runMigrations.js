const fs = require('fs')
const path = require('path')
const pool = require('./db')

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations')
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('[migrations] Папка migrations не найдена, пропускаем')
    return
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('[migrations] SQL-файлов нет, пропускаем')
    return
  }

  console.log(`[migrations] Нашли ${files.length} миграций, применяем...`)

  for (const file of files) {
    try {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      await pool.query(sql)
      console.log(`[migrations] ✅ ${file}`)
    } catch (err) {
      console.error(`[migrations] ❌ ${file}:`, err.message)
      throw err
    }
  }

  console.log('[migrations] Готово')
}

module.exports = { runMigrations }