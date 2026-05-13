const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { notifyNewBooking, notifyBookingCancelled, notifyRescheduleRequest } = require('./telegram')
const { sendBookingConfirmation, sendCoachNotification, sendBookingCancelledByCoachEmail } = require('./email')

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
  const { meeting_type_id, client_name, client_email, notes, date, time, timezone } = req.body
  try {
    const meetingResult = await pool.query(
      `SELECT mt.*, u.name as expert_name, u.id as user_id, u.telegram_chat_id
       FROM meeting_types mt 
       JOIN users u ON mt.user_id = u.id 
       WHERE mt.id = $1`,
      [meeting_type_id]
    )
    if (meetingResult.rows.length === 0) return res.status(404).json({ error: 'Meeting type not found' })
    const meeting = meetingResult.rows[0]

    const requireConfirm = meeting.require_confirm || false

    let startTime
    if (timezone) {
      const localDateStr = `${date}T${time}:00`
      const localDate = new Date(new Date(localDateStr).toLocaleString('en-US', { timeZone: timezone }))
      const utcOffset = new Date(localDateStr) - localDate
      startTime = new Date(new Date(localDateStr).getTime() + utcOffset)
    } else {
      startTime = new Date(`${date}T${time}:00`)
    }

    const endTime = new Date(startTime.getTime() + meeting.duration * 60000)
    const videoLink = `https://meet.jit.si/kogda-${meeting_type_id}-${Date.now()}`
    const clientToken = crypto.randomBytes(20).toString('hex')

    const bookingStatus = requireConfirm ? 'pending' : 'confirmed'
    const result = await pool.query(
      `INSERT INTO bookings 
       (meeting_type_id, client_name, client_email, notes, start_time, end_time, status, video_link, client_token) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [meeting_type_id, client_name, client_email, notes, startTime, endTime, bookingStatus, videoLink, clientToken]
    )

    const booking = result.rows[0]

    notifyNewBooking(booking, meeting.title, client_name, client_email, date, time, meeting.user_id, requireConfirm)

    const coachResult = await pool.query(
      'SELECT email, name, notify_email FROM users WHERE id = $1',
      [meeting.user_id]
    )
    if (coachResult.rows.length > 0 && coachResult.rows[0].notify_email) {
      const coach = coachResult.rows[0]
      sendCoachNotification(coach.email, coach.name, client_name, client_email, meeting.title, date, time, booking.id, requireConfirm)
    }

    if (!requireConfirm) {
      sendBookingConfirmation(client_email, client_name, meeting.title, date, time, videoLink, meeting.expert_name, clientToken)
    }

    res.json({ booking, video_link: videoLink })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Получить бронь по client_token (для клиента)
router.get('/client/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, mt.title as meeting_title, mt.duration, u.name as expert_name
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       JOIN users u ON mt.user_id = u.id
       WHERE b.client_token = $1`,
      [req.params.token]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Клиент запрашивает перенос
router.post('/client/:token/reschedule', async (req, res) => {
  const { new_date, new_time } = req.body
  try {
    const bookingResult = await pool.query(
      `SELECT b.*, mt.title as meeting_title, mt.duration, mt.user_id
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE b.client_token = $1`,
      [req.params.token]
    )
    if (bookingResult.rows.length === 0) return res.status(404).json({ error: 'Not found' })
    const booking = bookingResult.rows[0]

    const newStartTime = new Date(`${new_date}T${new_time}:00`)

    await pool.query(
      'UPDATE bookings SET reschedule_request = NOW(), reschedule_time = $1, status = $2 WHERE client_token = $3',
      [newStartTime, 'reschedule_requested', req.params.token]
    )

    notifyRescheduleRequest(booking.client_name, booking.meeting_title, new_date, new_time, booking.id, booking.user_id)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Клиент отменяет бронь (сам)
router.post('/client/:token/cancel', async (req, res) => {
  try {
    const bookingResult = await pool.query(
      `SELECT b.*, mt.title as meeting_title, mt.user_id
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE b.client_token = $1`,
      [req.params.token]
    )
    if (bookingResult.rows.length === 0) return res.status(404).json({ error: 'Not found' })
    const booking = bookingResult.rows[0]

    await pool.query('UPDATE bookings SET status = $1 WHERE client_token = $2', ['cancelled', req.params.token])

    const date = new Date(booking.start_time).toLocaleDateString('ru-RU')
    const time = new Date(booking.start_time).toTimeString().slice(0, 5)
    notifyBookingCancelled(booking.client_name, booking.meeting_title, date, time, booking.user_id)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Коуч подтверждает новую бронь
router.patch("/:id/confirm", auth, async (req, res) => {
  try {
    const current = await pool.query('SELECT status FROM bookings WHERE id = $1', [req.params.id])
    if (current.rows.length === 0) return res.status(404).json({ error: 'Not found' })
    const wasPending = current.rows[0].status === 'pending'

    const result = await pool.query(
      "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
      ["confirmed", req.params.id]
    )
    if (result.rows.length > 0 && wasPending) {
      const booking = result.rows[0]
      const meetingResult = await pool.query(
        "SELECT mt.title, u.name as expert_name FROM meeting_types mt JOIN users u ON mt.user_id = u.id WHERE mt.id = $1",
        [booking.meeting_type_id]
      )
      if (meetingResult.rows.length > 0) {
        const startDate = new Date(booking.start_time)
        const date = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`
        const time = `${String(startDate.getHours()).padStart(2,'0')}:${String(startDate.getMinutes()).padStart(2,'0')}`
        await sendBookingConfirmation(
          booking.client_email,
          booking.client_name,
          meetingResult.rows[0].title,
          date,
          time,
          booking.video_link,
          meetingResult.rows[0].expert_name,
          booking.client_token
        )
      }
    }
    res.json({ success: true })
  } catch (err) {
    console.error('Confirm error:', err)
    res.status(500).json({ error: "Server error" })
  }
})

// Коуч подтверждает перенос
router.patch('/:id/confirm-reschedule', auth, async (req, res) => {
  try {
    const bookingResult = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id])
    if (bookingResult.rows.length === 0) return res.status(404).json({ error: 'Not found' })
    const booking = bookingResult.rows[0]

    const meetingResult = await pool.query('SELECT duration FROM meeting_types WHERE id = $1', [booking.meeting_type_id])
    const duration = meetingResult.rows[0]?.duration || 60
    const newEndTime = new Date(new Date(booking.reschedule_time).getTime() + duration * 60000)

    await pool.query(
      'UPDATE bookings SET start_time = $1, end_time = $2, status = $3, reschedule_request = NULL, reschedule_time = NULL WHERE id = $4',
      [booking.reschedule_time, newEndTime, 'confirmed', req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Коуч отклоняет перенос
router.patch('/:id/reject-reschedule', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE bookings SET status = $1, reschedule_request = NULL, reschedule_time = NULL WHERE id = $2',
      ['confirmed', req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
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

// Коуч отменяет/отклоняет бронь
// Используется и для отмены confirmed, и для отклонения pending
// 1) UPDATE status = 'cancelled'
// 2) Telegram коучу (notifyBookingCancelled)
// 3) Email клиенту (sendBookingCancelledByCoachEmail) — встреча отменена
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const bookingResult = await pool.query(
      `SELECT b.*, mt.title as meeting_title, mt.user_id, u.name as expert_name
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       JOIN users u ON mt.user_id = u.id
       WHERE b.id = $1`,
      [req.params.id]
    )
    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' })
    }

    const booking = bookingResult.rows[0]

    if (booking.user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const startDate = new Date(booking.start_time)
    const dateRu = startDate.toLocaleDateString('ru-RU')
    const timeRu = startDate.toTimeString().slice(0, 5)
    const dateIso = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`

    notifyBookingCancelled(booking.client_name, booking.meeting_title, dateRu, timeRu, booking.user_id)

    sendBookingCancelledByCoachEmail(
      booking.client_email,
      booking.client_name,
      booking.meeting_title,
      dateIso,
      timeRu,
      booking.expert_name
    )

    await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error('[bookings cancel]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router