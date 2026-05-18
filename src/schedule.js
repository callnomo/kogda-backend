const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')
const { DateTime } = require('luxon')

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

// =========================================================
// GET /slots/:slug — доступные слоты для клиента
// =========================================================
// ВРЕМЯ ПЕРЕПИСАНО НА LUXON (18.05).
// Принцип:
//  - clientTz — пояс клиента (из ?timezone, как и было).
//  - Каждый слот — это КОНКРЕТНЫЙ момент времени (DateTime в clientTz
//    на запрашиваемую дату), а не абстрактные "минуты от полуночи".
//  - Занятость (брони) — тоже конкретные интервалы [start, end] во времени.
//  - Пересечение проверяется по реальным меткам времени.
//  Это убирает баги старого подхода: парсинг toLocaleString,
//  переход через полночь, DST, получасовые пояса.
//  Поведение (какие слоты показываются) — 1:1 как раньше.
//  Google здесь НЕ трогаем — отдельный следующий шаг.
// =========================================================
router.get('/slots/:slug', async (req, res) => {
  const { date, meeting_type_id, timezone } = req.query
  try {
    const userResult = await pool.query('SELECT id, schedule_type FROM users WHERE slug = $1', [req.params.slug])
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const userId = userResult.rows[0].id
    const scheduleType = userResult.rows[0].schedule_type || 'standard'
    const clientTz = timezone || 'UTC'

    // Валидация даты (YYYY-MM-DD). Невалидная → пустой ответ, не падаем.
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.json({ slots: [], day: null })
    }

    // День недели и человекочитаемое имя дня — стабильно через luxon
    // (полдень нужной даты в clientTz, чтобы не было сдвига на границе суток)
    const dayAnchor = DateTime.fromISO(`${date}T12:00:00`, { zone: clientTz })
    if (!dayAnchor.isValid) {
      return res.json({ slots: [], day: null })
    }
    // luxon weekday: 1=Пн..7=Вс. Нам нужен индекс для DAYS (0=Вс..6=Сб).
    const dowForName = dayAnchor.weekday % 7 // 7(Вс)->0, 1(Пн)->1, ... 6(Сб)->6
    const dayName = DAYS[dowForName]

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

    // "Сейчас" — абсолютный момент. Сравнения делаем в абсолютном времени,
    // поэтому отдельно "сегодня в поясе клиента" вычислять не нужно.
    const now = DateTime.now()
    // Начало запрашиваемого дня в поясе клиента (для проверки "этот день уже прошёл" и т.п.)
    const dayStart = DateTime.fromISO(`${date}T00:00:00`, { zone: clientTz })

    // Проверяем исключение для этой даты (override закрывает день)
    const overrideResult = await pool.query(
      'SELECT * FROM schedule_overrides WHERE user_id = $1 AND date = $2',
      [userId, date]
    )
    if (overrideResult.rows.length > 0 && !overrideResult.rows[0].is_available) {
      return res.json({ slots: [], day: dayName, closed: true })
    }

    // Все активные брони коуча
    const bookingsResult = await pool.query(
      `SELECT b.start_time, b.end_time, mt.buffer_before, mt.buffer_after
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE mt.user_id = $1 AND b.status != 'cancelled'`,
      [userId]
    )

    // Переводим брони в моменты времени в поясе клиента.
    // start_time/end_time из БД — абсолютные (timestamp). luxon корректно
    // покажет их в clientTz с учётом DST.
    const dayBookings = bookingsResult.rows
      .map(b => {
        const start = DateTime.fromJSDate(new Date(b.start_time)).setZone(clientTz)
        const end = DateTime.fromJSDate(new Date(b.end_time)).setZone(clientTz)
        return {
          start,
          end,
          bufferBefore: b.buffer_before || 0,
          bufferAfter: b.buffer_after || 0,
        }
      })
      // Только брони, попадающие на запрашиваемый день (в поясе клиента)
      .filter(b => b.start.toFormat('yyyy-MM-dd') === date)

    // Проверка макс встреч в день (считаем только брони kogDA — как и раньше)
    if (maxPerDay > 0 && dayBookings.length >= maxPerDay) {
      return res.json({ slots: [], day: dayName, full: true })
    }

    // Занятые интервалы [from, to] как АБСОЛЮТНЫЕ моменты (с буферами).
    // Сравнение слотов с занятостью — по реальному времени, не по минутам.
    const busyRanges = dayBookings.map(b => ({
      from: b.start.minus({ minutes: b.bufferBefore }),
      to: b.end.plus({ minutes: b.bufferAfter }),
    }))

    // Проверка: свободен ли слот, начинающийся в момент slotStart (DateTime).
    const isSlotFree = (slotStart) => {
      const slotEndWithBuffer = slotStart.plus({ minutes: duration + bufferAfter })
      const slotStartWithBuffer = slotStart.minus({ minutes: bufferBefore })

      // 1. Слот не должен быть в прошлом (абсолютное сравнение)
      if (slotStart <= now) return false

      // 2. Минимальный запас до записи (minNotice часов от "сейчас")
      if (minNotice > 0) {
        const diffHours = slotStart.diff(now, 'hours').hours
        if (diffHours < minNotice) return false
      }

      // 3. Пересечение с занятыми интервалами (брони + буферы)
      for (const range of busyRanges) {
        // пересечение интервалов: startA < endB && endA > startB
        if (slotStartWithBuffer < range.to && slotEndWithBuffer > range.from) {
          return false
        }
      }
      return true
    }

    // Генерация слотов из рабочего окна [winStartMin, winEndMin] (минуты от
    // полуночи в clientTz) — но каждый слот сразу превращаем в момент времени.
    const collectSlots = (winStartMin, winEndMin, out) => {
      let cur = winStartMin
      while (cur + duration <= winEndMin) {
        const h = Math.floor(cur / 60)
        const m = cur % 60
        // Момент начала слота: запрашиваемая дата + h:m в поясе клиента
        const slotStart = DateTime.fromISO(
          `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`,
          { zone: clientTz }
        )
        if (slotStart.isValid && isSlotFree(slotStart)) {
          out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
        }
        cur += duration
      }
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
        collectSlots(sh * 60 + sm, eh * 60 + em, slots)
      }
    } else {
      // luxon weekday 1..7 (Пн..Вс) → старый getDay() 0..6 (Вс..Сб)
      const dayOfWeek = dayAnchor.weekday % 7
      const scheduleResult = await pool.query(
        'SELECT * FROM schedules WHERE user_id = $1 AND day_of_week = $2 AND is_active = true',
        [userId, dayOfWeek]
      )
      if (scheduleResult.rows.length > 0) {
        const schedule = scheduleResult.rows[0]
        const [sh, sm] = schedule.start_time.split(':').map(Number)
        const [eh, em] = schedule.end_time.split(':').map(Number)
        collectSlots(sh * 60 + sm, eh * 60 + em, slots)
      }
    }

    res.json({ slots, day: dayName })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router