// Задаёт sort_order = 1, 2, 3... всем существующим услугам каждого юзера,
// у которых sort_order = 0 (значение по умолчанию после миграции).
// Идемпотентный — если sort_order уже задан, не трогает.
const pool = require('./db')

async function backfillSortOrder() {
  try {
    // Находим всех юзеров у которых есть услуги с sort_order = 0
    const users = await pool.query(
      `SELECT DISTINCT user_id FROM meeting_types WHERE sort_order = 0`
    )

    if (users.rows.length === 0) {
      console.log('[sort-order-backfill] Все услуги уже имеют sort_order, пропускаем')
      return
    }

    console.log(`[sort-order-backfill] Задаём sort_order для ${users.rows.length} юзеров...`)

    for (const { user_id } of users.rows) {
      // Берём услуги юзера в нужном порядке (новые сверху = меньший sort_order)
      const meetings = await pool.query(
        `SELECT id FROM meeting_types WHERE user_id = $1 ORDER BY created_at DESC`,
        [user_id]
      )

      // Присваиваем 1, 2, 3...
      for (let i = 0; i < meetings.rows.length; i++) {
        await pool.query(
          `UPDATE meeting_types SET sort_order = $1 WHERE id = $2`,
          [i + 1, meetings.rows[i].id]
        )
      }

      console.log(`[sort-order-backfill] ✅ user_id=${user_id}: ${meetings.rows.length} услуг`)
    }

    console.log('[sort-order-backfill] Готово')
  } catch (err) {
    console.error('[sort-order-backfill] ❌ Ошибка:', err.message)
    throw err
  }
}

module.exports = { backfillSortOrder }