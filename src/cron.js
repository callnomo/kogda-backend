const cron = require('node-cron')
const pool = require('./db')
const { notifyReminder24h, notifyReminder1h, notifyDailySummary, notifyPendingReminder, notifyBookingExpired } = require('./telegram')
const { sendBookingExpiredClient, sendBookingExpiredCoach, sendPendingReminderCoach } = require('./email')

// Утренняя сводка — каждый день в 9:00 по Bangkok
// Шлём отдельно каждому активному юзеру (deleted_at IS NULL + Telegram подключён + notify_telegram=true)
cron.schedule('0 9 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0]

    const users = await pool.query(
      `SELECT id, telegram_chat_id 
       FROM users 
       WHERE deleted_at IS NULL 
         AND telegram_chat_id IS NOT NULL 
         AND notify_telegram = true`
    )

    for (const user of users.rows) {
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

// ============================================================
// Обработка pending-запросов — каждые 15 минут
// Часть А: протухшие (время встречи прошло) → cancelled + письма/ТГ
// Часть Б: висящие (ещё в будущем) → напоминание коучу по триггерам
// Email шлём ВСЕГДА. Telegram — если коуч подключил (проверка внутри telegram.js).
// ============================================================
cron.schedule('*/15 * * * *', async () => {
  // --- Часть А: протухшие pending ---
  try {
    const expired = await pool.query(
      `SELECT b.*, mt.title AS meeting_title, mt.user_id,
              u.name AS coach_name, u.email AS coach_email
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       JOIN users u ON mt.user_id = u.id
       WHERE b.status = 'pending'
         AND b.start_time < NOW()
         AND u.deleted_at IS NULL`
    )

    for (const b of expired.rows) {
      try {
        // 1. Переводим в cancelled
        await pool.query(
          `UPDATE bookings SET status = 'cancelled' WHERE id = $1`,
          [b.id]
        )

        // 2. Уведомления — только если ещё не слали
        if (!b.expired_notified_at) {
          const startDate = new Date(b.start_time)
          const dateIso = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`
          const timeRu = startDate.toTimeString().slice(0, 5)
          const dateRu = startDate.toLocaleDateString('ru-RU')

          // Клиенту — email (на ВЫ). У клиента нет Telegram.
          await sendBookingExpiredClient(
            b.client_email, b.client_name, b.meeting_title,
            dateIso, timeRu, b.coach_name
          )

          // Коучу — email всегда
          await sendBookingExpiredCoach(
            b.coach_email, b.coach_name, b.client_name, b.client_email,
            b.meeting_title, dateIso, timeRu
          )

          // Коучу — Telegram если подключён (getUserChatId внутри сам проверит)
          await notifyBookingExpired(
            b.client_name, b.meeting_title, dateRu, timeRu, b.user_id
          )

          // Помечаем что уведомили
          await pool.query(
            `UPDATE bookings SET expired_notified_at = NOW() WHERE id = $1`,
            [b.id]
          )
        }
      } catch (err) {
        console.error(`[cron pending-expire] booking ${b.id}:`, err.message)
      }
    }
  } catch (err) {
    console.error('Cron pending-expire error:', err)
  }

  // --- Часть Б: висящие pending (напоминание коучу) ---
  try {
    const now = Date.now()

    const pending = await pool.query(
      `SELECT b.*, mt.title AS meeting_title, mt.user_id,
              u.name AS coach_name, u.email AS coach_email
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       JOIN users u ON mt.user_id = u.id
       WHERE b.status = 'pending'
         AND b.start_time > NOW()
         AND u.deleted_at IS NULL`
    )

    for (const b of pending.rows) {
      try {
        const startMs = new Date(b.start_time).getTime()
        const createdMs = new Date(b.created_at).getTime()
        const hoursUntil = (startMs - now) / (1000 * 60 * 60)
        const hoursSinceCreated = (now - createdMs) / (1000 * 60 * 60)

        // Триггер: ≥24ч с создания ИЛИ до встречи ≤24ч ИЛИ до встречи ≤12ч
        const triggered =
          hoursSinceCreated >= 24 ||
          hoursUntil <= 24 ||
          hoursUntil <= 12

        if (!triggered) continue

        // Защита от спама: слать только если не слали вообще
        // или последнее напоминание было больше 12 часов назад
        let canSend = true
        if (b.pending_reminder_sent_at) {
          const lastMs = new Date(b.pending_reminder_sent_at).getTime()
          const hoursSinceLast = (now - lastMs) / (1000 * 60 * 60)
          if (hoursSinceLast < 12) canSend = false
        }
        if (!canSend) continue

        const startDate = new Date(b.start_time)
        const dateIso = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`
        const timeRu = startDate.toTimeString().slice(0, 5)
        const dateRu = startDate.toLocaleDateString('ru-RU')

        // Коучу — email всегда
        await sendPendingReminderCoach(
          b.coach_email, b.coach_name, b.client_name, b.client_email,
          b.meeting_title, dateIso, timeRu
        )

        // Коучу — Telegram если подключён
        await notifyPendingReminder(
          b.client_name, b.client_email, b.meeting_title,
          dateRu, timeRu, b.id, b.user_id
        )

        // Помечаем время последнего напоминания
        await pool.query(
          `UPDATE bookings SET pending_reminder_sent_at = NOW() WHERE id = $1`,
          [b.id]
        )
      } catch (err) {
        console.error(`[cron pending-remind] booking ${b.id}:`, err.message)
      }
    }
  } catch (err) {
    console.error('Cron pending-remind error:', err)
  }
})

// Реальное удаление аккаунтов через 30 дней — каждый день в 3:00 ночи
// CASCADE удалит meeting_types, bookings, schedules, schedule_overrides, flexible_schedule
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