// Запускается один раз вместе с миграциями.
// Идемпотентный — если slug уже есть, пропускает.
const pool = require('./db')
const { makeSlug, makeUniqueSlug } = require('./slugify')

async function backfillMeetingSlugs() {
  try {
    // Берём все услуги где slug пустой
    const result = await pool.query(
      `SELECT id, user_id, title FROM meeting_types WHERE slug IS NULL OR slug = ''`
    )

    if (result.rows.length === 0) {
      console.log('[slug-backfill] Все услуги уже имеют slug, пропускаем')
      return
    }

    console.log(`[slug-backfill] Генерируем slug для ${result.rows.length} услуг...`)

    for (const meeting of result.rows) {
      const baseSlug = makeSlug(meeting.title)
      const uniqueSlug = await makeUniqueSlug(pool, meeting.user_id, baseSlug, meeting.id)
      
      await pool.query(
        'UPDATE meeting_types SET slug = $1 WHERE id = $2',
        [uniqueSlug, meeting.id]
      )
      
      console.log(`[slug-backfill] ✅ id=${meeting.id} "${meeting.title}" → "${uniqueSlug}"`)
    }

    console.log('[slug-backfill] Готово')
  } catch (err) {
    console.error('[slug-backfill] ❌ Ошибка:', err.message)
    throw err
  }
}

module.exports = { backfillMeetingSlugs }