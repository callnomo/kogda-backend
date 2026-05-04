const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = decoded.userId
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

const DAYS = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']

router.get('/type', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT schedule_type FROM users WHERE id = $1', [req.userId])
    res.json({ schedule_type: result.rows[0]?.schedule_type || 'standard' })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/type', auth, async (req, res) => {
  const { schedule_type } = req.body
  try {
    await pool.query('UPDATE users SET schedule_type = $1 WHERE id = $2', [schedule_type, req.userId])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM schedules WHERE user_id = $1 ORDER BY day_of_week', [req.userId])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', auth, async (req, res) => {
  const { schedule } = req.body
  try {
    await pool.query('DELETE FROM schedules WHERE user_id = $1', [req.userId])
    for (const slot of schedule) {
      if (slot.is_active) {
        await pool.query(
          'INSERT INTO schedules (user_id, day_of_week, start_time, end_time, is_active) VALUES ($1, $2, $3, $4, $5)',
          [req.userId, slot.day_of_week, slot.start_time, slot.end_time, true]
        )
      }
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/flexible', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM flexible_schedule WHERE user_id = $1 AND date >= CURRENT_DATE ORDER BY date, start_time',
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/flexible', auth, async (req, res) => {
  const { date, start_time, end_time } = req.body
  try {
    const result = await pool.query(
      'INSERT INTO flexible_schedule (user_id, date, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.userId, date, start_time, end_time]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/flexible/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM flexible_schedule WHERE id = $1 AND user_id = $2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Получить исключения дат
router.get('/overrides', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM schedule_overrides WHERE user_id = $1 AND date >= CURRENT_DATE ORDER BY date',
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Добавить исключение даты (закрыть день)
router.post('/overrides', auth, async (req, res) => {
  const { date, is_available, reason } = req.body
  try {
    // Удаляем если уже есть
    await pool.query('DELETE FROM schedule_overrides WHERE user_id = $1 AND date = $2', [req.userId, date])
    const result = await pool.query(
      'INSERT INTO schedule_overrides (user_id, date, is_available, reason) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.userId, date, is_available ?? false, reason || null]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Удалить исключение (восстановить день)
router.delete('/overrides/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM schedule_overrides WHERE id = $1 AND user_id = $2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Получить доступные слоты для клиента
router.get('/slots/:slug', async (req, res) => {
  const { date, meeting_type_id, timezone } = req.query
  try {
    const userResult = await pool.query('SELECT id, schedule_type FROM users WHERE slug = $1', [req.params.slug])
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const userId = userResult.rows[0].id
    const scheduleType = userResult.rows[0].schedule_type || 'standard'
    const clientTz = timezone || 'UTC'

    // Параметры услуги
    let duration = 60
    let bufferBefore = 0
    let bufferAfter = 0
    let minNotice = 0   // часов до записи
    let maxPerDay = 0   // макс встреч в день (0 = без лимита)

    if (meeting_type_id) {
      const mtResult = await pool.query(
        'SELECT duration, buffer_before, buffer_after, min_notice, max_per_day FROM meeting_types WHERE id = $1',
        [meeting_type_id]
      )
      if (mtResult.rows.length > 0) {
        duration = mtResult.rows[0].duration
        bufferBefore = mtResult.rows[0].buffer_before || 0
        bufferAfter = mtResult.rows[0].buffer_after || 0
        minNotice = mtResult.rows[0].min_notice || 0
        maxPerDay = mtResult.rows[0].max_per_day || 0
      }
    }

    // Текущее время в часовом поясе клиента
    const nowInClientTz = new Date(new Date().toLocaleString('en-US', { timeZone: clientTz }))
    const todayInClientTz = `${nowInClientTz.getFullYear()}-${String(nowInClientTz.getMonth()+1).padStart(2,'0')}-${String(nowInClientTz.getDate()).padStart(2,'0')}`
    const isToday = date === todayInClientTz
    const nowMinutes = nowInClientTz.getHours() * 60 + nowInClientTz.getMinutes()
    const minNoticeMinutes = minNotice * 60

    // Проверяем исключение для этой даты
    const overrideResult = await pool.query(
      'SELECT * FROM schedule_overrides WHERE user_id = $1 AND date = $2',
      [userId, date]
    )
    if (overrideResult.rows.length > 0 && !overrideResult.rows[0].is_available) {
      return res.json({ slots: [], day: DAYS[new Date(date + 'T12:00:00').getDay()], closed: true })
    }

    // Все активные брони коуча (для подсчёта занятости)
    const bookingsResult = await pool.query(
      `SELECT b.start_time, b.end_time, mt.buffer_before, mt.buffer_after
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE mt.user_id = $1 AND b.status != 'cancelled'`,
      [userId]
    )

    // Брони на этот день в часовом поясе клиента
    const dayBookings = bookingsResult.rows.filter(b => {
      const startInClientTz = new Date(new Date(b.start_time).toLocaleString('en-US', { timeZone: clientTz }))
      const bookingDate = `${startInClientTz.getFullYear()}-${String(startInClientTz.getMonth()+1).padStart(2,'0')}-${String(startInClientTz.getDate()).padStart(2,'0')}`
      return bookingDate === date
    })

    // Проверка макс встреч в день
    if (maxPerDay > 0 && dayBookings.length >= maxPerDay) {
      return res.json({ slots: [], day: DAYS[new Date(date + 'T12:00:00').getDay()], full: true })
    }

    // Занятые диапазоны с буферами
    const busyRanges = dayBookings.map(b => {
      const startInClientTz = new Date(new Date(b.start_time).toLocaleString('en-US', { timeZone: clientTz }))
      const endInClientTz = new Date(new Date(b.end_time).toLocaleString('en-US', { timeZone: clientTz }))
      return {
        from: startInClientTz.getHours() * 60 + startInClientTz.getMinutes() - (b.buffer_before || 0),
        to: endInClientTz.getHours() * 60 + endInClientTz.getMinutes() + (b.buffer_after || 0)
      }
    })

    const isSlotFree = (slotStart) => {
      // Прошедшие слоты сегодня
      if (isToday && slotStart <= nowMinutes) return false
      // Минимум до записи
      if (isToday && slotStart < nowMinutes + minNoticeMinutes) return false
      // Для будущих дней — минимум до записи в абсолютном времени
      if (!isToday && minNotice > 0) {
        const slotDatetime = new Date(`${date}T${String(Math.floor(slotStart/60)).padStart(2,'0')}:${String(slotStart%60).padStart(2,'0')}:00`)
        const nowUtc = new Date()
        if ((slotDatetime - nowUtc) / (1000 * 60 * 60) < minNotice) return false
      }
      // Пересечение с бронями
      const slotEnd = slotStart + duration + bufferAfter
      const slotStartWithBuffer = slotStart - bufferBefore
      for (const range of busyRanges) {
        if (slotStartWithBuffer < range.to && slotEnd > range.from) return false
      }
      return true
    }

    let slots = []

    if (scheduleType === 'flexible') {
      const flexResult = await pool.query(
        'SELECT * FROM flexible_schedule WHERE user_id = $1 AND date = $2',
        [userId, date]
      )
      for (const flex of flexResult.rows) {
        const [sh, sm] = flex.start_time.split(':').map(Number)
        const [eh, em] = flex.end_time.split(':').map(Number)
        let current = sh * 60 + sm
        const end = eh * 60 + em
        while (current + duration <= end) {
          if (isSlotFree(current)) {
            slots.push(`${Math.floor(current/60).toString().padStart(2,'0')}:${(current%60).toString().padStart(2,'0')}`)
          }
          current += duration
        }
      }
    } else {
      const dayOfWeek = new Date(date + 'T12:00:00').getDay()
      const scheduleResult = await pool.query(
        'SELECT * FROM schedules WHERE user_id = $1 AND day_of_week = $2 AND is_active = true',
        [userId, dayOfWeek]
      )
      if (scheduleResult.rows.length > 0) {
        const schedule = scheduleResult.rows[0]
        const [sh, sm] = schedule.start_time.split(':').map(Number)
        const [eh, em] = schedule.end_time.split(':').map(Number)
        let current = sh * 60 + sm
        const end = eh * 60 + em
        while (current + duration <= end) {
          if (isSlotFree(current)) {
            slots.push(`${Math.floor(current/60).toString().padStart(2,'0')}:${(current%60).toString().padStart(2,'0')}`)
          }
          current += duration
        }
      }
    }

    res.json({ slots, day: DAYS[new Date(date + 'T12:00:00').getDay()] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router