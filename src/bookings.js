const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')
const { notifyNewBooking } = require('./telegram')

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

// Создать бронирование
router.post('/', async (req, res) => {
  const { meeting_type_id, client_name, client_email, notes, date, time } = req.body
  try {
    const meetingResult = await pool.query(
      'SELECT * FROM meeting_types WHERE id = $1',
      [meeting_type_id]
    )
    if (meetingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Meeting type not found' })
    }
    const meeting = meetingResult.rows[0]

    const startTime = new Date(`${date}T${time}:00`)
    const endTime = new Date(startTime.getTime() + meeting.duration * 60000)
    const videoLink = `https://meet.jit.si/kogda-${meeting_type_id}-${Date.now()}`

    const result = await pool.query(
      'INSERT INTO bookings (meeting_type_id, client_name, client_email, notes, start_time, end_time, status, video_link) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [meeting_type_id, client_name, client_email, notes, startTime, endTime, 'confirmed', videoLink]
    )

    // Отправляем уведомление в Telegram
    notifyNewBooking(result.rows[0], meeting.title, client_name, client_email, date, time)

    res.json({ booking: result.rows[0], video_link: videoLink })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Получить все брони коуча
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, mt.title as meeting_title, mt.duration
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE mt.user_id = $1
       ORDER BY b.start_time DESC`,
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Отменить бронь
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE bookings SET status = $1 WHERE id = $2',
      ['cancelled', req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router