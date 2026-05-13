const cron = require('node-cron')
const pool = require('./db')
const { notifyReminder24h, notifyReminder1h, notifyDailySummary } = require('./telegram')

// Утренняя сводка — каждый день в 9:00 по Bangkok
// Шлём отдельно каждому активному юзеру (deleted_at IS NULL + Telegram подключён + notify_telegram=true)
cron.schedule('0 9 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0]

    // Все активные юзеры с подключённым Telegram
    const users = await pool.query(
      `SELECT id, telegram_chat_id 
       FROM users 
       WHERE deleted_at IS NULL 
         AND telegram_chat_id IS NOT NULL 
         AND notify_telegram = true`
    )

    for (const user of users.rows) {
      // Записи именно этого юзера на сегодня
      const result = await pool.query(
        `SELECT b.start_time, b.client_name, mt.title as meeting_title
         FROM bookings b
         JOIN meeting_types mt ON b.meeting_type_id = mt.id
         WHERE mt.user_id = $1 
           AND DATE(b.start_time) = $2 
           AND b.status = 'confirmed'
         ORDER BY b.start_time`,
        [user.id, today]
      )

      const bookings = result.rows.map(b => ({
        time: new Date(b.start_time).toTimeString().slice(0, 5),
        client_name: b.client_name,
        meeting_title: b.meeting_title
      }))

      await notifyDailySummary(bookings, user.id)
    }
  } catch (err) {
    console.error('Cron daily summary error:', err)
  }
}, { timezone: 'Asia/Bangkok' })

// Напоминание за 24 часа — каждый час проверяем
// Только для записей у активных юзеров
cron.schedule('0 * * * *', async () => {
  try {
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const from = new Date(in24h.getTime() - 30 * 60 * 1000)
    const to = new Date(in24h.getTime() + 30 * 60 * 1000)

    const result = await pool.query(
      `SELECT b.*, mt.title as meeting_title, mt.user_id
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       JOIN users u ON mt.user_id = u.id
       WHERE b.start_time BETWEEN $1 AND $2 
         AND b.status = 'confirmed'
         AND u.deleted_at IS NULL
         AND u.notify_telegram = true`,
      [from, to]
    )

    for (const booking of result.rows) {
      const date = new Date(booking.start_time).toLocaleDateString('ru-RU')
      const time = new Date(booking.start_time).toTimeString().slice(0, 5)
      await notifyReminder24h(booking.client_name, booking.meeting_title, date, time, booking.video_link, booking.user_id)
    }
  } catch (err) {
    console.error('Cron 24h reminder error:', err)
  }
})

// Напоминание за 1 час — каждые 30 минут проверяем
cron.schedule('*/30 * * * *', async () => {
  try {
    const in1h = new Date(Date.now() + 60 * 60 * 1000)
    const from = new Date(in1h.getTime() - 15 * 60 * 1000)
    const to = new Date(in1h.getTime() + 15 * 60 * 1000)

    const result = await pool.query(
      `SELECT b.*, mt.title as meeting_title, mt.user_id
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       JOIN users u ON mt.user_id = u.id
       WHERE b.start_time BETWEEN $1 AND $2 
         AND b.status = 'confirmed'
         AND u.deleted_at IS NULL
         AND u.notify_telegram = true`,
      [from, to]
    )

    for (const booking of result.rows) {
      const time = new Date(booking.start_time).toTimeString().slice(0, 5)
      await notifyReminder1h(booking.client_name, booking.meeting_title, time, booking.video_link, booking.user_id)
    }
  } catch (err) {
    console.error('Cron 1h reminder error:', err)
  }
})

// Реальное удаление аккаунтов через 30 дней — каждый день в 3:00 ночи
// Логика: находим юзеров где scheduled_delete_at прошло — DELETE из users
// CASCADE удалит все meeting_types, bookings, schedules, schedule_overrides, flexible_schedule
cron.schedule('0 3 * * *', async () => {
  try {
    const result = await pool.query(
      `SELECT id, email FROM users 
       WHERE scheduled_delete_at IS NOT NULL 
         AND scheduled_delete_at < NOW()`
    )

    if (result.rows.length === 0) {
      return
    }

    console.log(`[cron account-purge] Найдено аккаунтов для удаления: ${result.rows.length}`)

    for (const user of result.rows) {
      try {
        await pool.query('DELETE FROM users WHERE id = $1', [user.id])
        console.log(`[cron account-purge] Удалён аккаунт ${user.email} (id=${user.id})`)
      } catch (err) {
        console.error(`[cron account-purge] Ошибка удаления ${user.email}:`, err.message)
      }
    }
  } catch (err) {
    console.error('Cron account-purge error:', err)
  }
}, { timezone: 'Asia/Bangkok' })

console.log('Cron jobs запущены!')