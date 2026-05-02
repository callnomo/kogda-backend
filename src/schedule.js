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

const DAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']

// Получить расписание
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

// Сохранить расписание
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

// Получить доступные слоты для клиента
router.get('/slots/:slug', async (req, res) => {
  const { date } = req.query
  try {
    const userResult = await pool.query(
      'SELECT id FROM users WHERE slug = $1',
      [req.params.slug]
    )
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    const userId = userResult.rows[0].id
    const dayOfWeek = new Date(date).getDay()

    const scheduleResult = await pool.query(
      'SELECT * FROM schedules WHERE user_id = $1 AND day_of_week = $2 AND is_active = true',
      [userId, dayOfWeek]
    )

    if (scheduleResult.rows.length === 0) {
      return res.json({ slots: [] })
    }

    const schedule = scheduleResult.rows[0]
    const bookingsResult = await pool.query(
      'SELECT start_time FROM bookings WHERE meeting_type_id IN (SELECT id FROM meeting_types WHERE user_id = $1) AND DATE(start_time) = $2 AND status != $3',
      [userId, date, 'cancelled']
    )

    const bookedTimes = bookingsResult.rows.map(b => {
      const d = new Date(b.start_time)
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    })

    const slots = []
    const [startH, startM] = schedule.start_time.split(':').map(Number)
    const [endH, endM] = schedule.end_time.split(':').map(Number)
    let current = startH * 60 + startM
    const end = endH * 60 + endM

    while (current + 30 <= end) {
      const h = Math.floor(current / 60).toString().padStart(2, '0')
      const m = (current % 60).toString().padStart(2, '0')
      const time = `${h}:${m}`
      if (!bookedTimes.includes(time)) {
        slots.push(time)
      }
      current += 30
    }

    res.json({ slots, day: DAYS[dayOfWeek] })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router