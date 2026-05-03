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

// Получить тип расписания
router.get('/type', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT schedule_type FROM users WHERE id = $1', [req.userId])
    res.json({ schedule_type: result.rows[0]?.schedule_type || 'standard' })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Сменить тип расписания
router.post('/type', auth, async (req, res) => {
  const { schedule_type } = req.body
  try {
    await pool.query('UPDATE users SET schedule_type = $1 WHERE id = $2', [schedule_type, req.userId])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Получить стандартное расписание
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM schedules WHERE user_id = $1 ORDER BY day_of_week',
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Сохранить стандартное расписание
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

// Получить гибкое расписание
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

// Добавить слот в гибкое расписание
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

// Удалить слот из гибкого расписания
router.delete('/flexible/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM flexible_schedule WHERE id = $1 AND user_id = $2', [req.params.id, req.userId])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Получить доступные слоты для клиента
router.get('/slots/:slug', async (req, res) => {
  const { date } = req.query
  try {
    const userResult = await pool.query('SELECT id, schedule_type FROM users WHERE slug = $1', [req.params.slug])
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const userId = userResult.rows[0].id
    const scheduleType = userResult.rows[0].schedule_type || 'standard'

    const bookingsResult = await pool.query(
      `SELECT start_time FROM bookings 
       WHERE meeting_type_id IN (SELECT id FROM meeting_types WHERE user_id = $1) 
       AND DATE(start_time) = $2 AND status != 'cancelled'`,
      [userId, date]
    )
    const bookedTimes = bookingsResult.rows.map(b => {
      const d = new Date(b.start_time)
      return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
    })

    let slots = []

    if (scheduleType === 'flexible') {
      // Гибкое расписание
      const flexResult = await pool.query(
        'SELECT * FROM flexible_schedule WHERE user_id = $1 AND date = $2',
        [userId, date]
      )
      for (const flex of flexResult.rows) {
        const [sh, sm] = flex.start_time.split(':').map(Number)
        const [eh, em] = flex.end_time.split(':').map(Number)
        let current = sh * 60 + sm
        const end = eh * 60 + em
        while (current + 30 <= end) {
          const h = Math.floor(current/60).toString().padStart(2,'0')
          const m = (current%60).toString().padStart(2,'0')
          const time = `${h}:${m}`
          if (!bookedTimes.includes(time)) slots.push(time)
          current += 30
        }
      }
    } else {
      // Стандартное расписание
      const dayOfWeek = new Date(date).getDay()
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
        while (current + 30 <= end) {
          const h = Math.floor(current/60).toString().padStart(2,'0')
          const m = (current%60).toString().padStart(2,'0')
          const time = `${h}:${m}`
          if (!bookedTimes.includes(time)) slots.push(time)
          current += 30
        }
      }
    }

    res.json({ slots, day: DAYS[new Date(date).getDay()] })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router