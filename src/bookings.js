const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const { DateTime } = require('luxon')
// getGoogleBusy: занятость коуча из Google (FreeBusy). При сбое → [] (бронь не блокируется ложно)
const { getGoogleBusy, createBookingEvent } = require('./integrations')
const { notifyNewBooking, notifyBookingCancelled, notifyRescheduleRequest } = require('./telegram')
const { sendBookingConfirmation, sendCoachNotification, sendBookingCancelledByCoachEmail, sendBookingRescheduleRequestByCoachEmail } = require('./email')
// Рефакторинг Б: общая бизнес-логика 4 действий жизненного цикла брони.
// confirmBooking — Шаг Б.1; вызывается также из telegram.js (callback кнопки).
const { confirmBooking, cancelBooking } = require('./bookingLifecycle')

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

    // === Расчёт времени брони на LUXON (18.05) ===
    // ВАЖНО: строим момент времени ТЕМ ЖЕ способом, что schedule.js строит
    // слот: DateTime.fromISO(`${date}T${time}:00`, { zone: clientTz }).
    // Иначе бронь сохранится не в то время, которое клиент видел в слотах
    // (старый код через toLocaleString + ручной utcOffset давал расхождение
    //  на DST и получасовых поясах). Теперь расчёт идентичен показу слотов.
    const clientTz = timezone || 'UTC'
    const dt = DateTime.fromISO(`${date}T${time}:00`, { zone: clientTz })
    if (!dt.isValid) {
      return res.status(400).json({ error: 'Неверная дата или время' })
    }
    const startTime = dt.toJSDate()
    const endTime = dt.plus({ minutes: meeting.duration }).toJSDate()

    const videoLink = `https://meet.jit.si/kogda-${meeting_type_id}-${Date.now()}`
    const clientToken = crypto.randomBytes(20).toString('hex')

    // === АНТИ-ОВЕРБУКИНГ: синхронная проверка перед INSERT (3a-3, 18.05) ===
    // Закрывает дыру: между показом слотов и подтверждением брони время
    // могли занять (другой клиент kogDA ИЛИ коуч лично в Google).
    // 1) Своя база: есть ли активная бронь этого коуча, пересекающая
    //    [startTime, endTime]. Пересечение интервалов: A.start < B.end && A.end > B.start.
    const overlap = await pool.query(
      `SELECT b.id FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE mt.user_id = $1
         AND b.status IN ('confirmed','pending')
         AND b.start_time < $3
         AND b.end_time   > $2
       LIMIT 1`,
      [meeting.user_id, startTime, endTime]
    )
    if (overlap.rows.length > 0) {
      return res.status(409).json({
        error: 'slot_taken',
        message: 'Это время только что заняли. Пожалуйста, выберите другой слот.'
      })
    }

    // 2) Google-календарь коуча (FreeBusy). При сбое Google → [] → проверка
    //    пропускается, бронь НЕ блокируется ложно (своя база уже проверена выше).
    try {
      const gBusy = await getGoogleBusy(meeting.user_id, startTime.toISOString(), endTime.toISOString())
      const conflict = gBusy.some(gb => {
        const gs = new Date(gb.start)
        const ge = new Date(gb.end)
        // пересечение со слотом брони
        return gs < endTime && ge > startTime
      })
      if (conflict) {
        return res.status(409).json({
          error: 'slot_taken',
          message: 'Это время только что заняли. Пожалуйста, выберите другой слот.'
        })
      }
    } catch (e) {
      // Сбой Google не должен ронять бронь — своя база уже проверена.
      console.error('Google busy check error (не критично):', e.message)
    }

    const bookingStatus = requireConfirm ? 'pending' : 'confirmed'
    const result = await pool.query(
      `INSERT INTO bookings
       (meeting_type_id, client_name, client_email, notes, start_time, end_time, status, video_link, client_token, client_timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [meeting_type_id, client_name, client_email, notes, startTime, endTime, bookingStatus, videoLink, clientToken, clientTz]
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

      // Google-запись брони (Шаг 3b + 3b-2 Шаг B):
      //  - ТОЛЬКО для сразу подтверждённых броней. Для pending событие в Google
      //    создастся позже, когда коуч нажмёт "Подтвердить" (следующий шаг 3b-2).
      //  - При успехе сохраняем eventId+calendarId в саму бронь — нужно чтобы
      //    потом удалить/перенести Google-событие при отмене/переносе брони.
      //  - Без await — побочный эффект, не критический путь. Любая ошибка
      //    (Google или UPDATE) только логируется: бронь и нотификации уже
      //    произошли, клиенту ответ ушёл.
      createBookingEvent(meeting.user_id, {
        summary: meeting.title,
        description: `Клиент: ${client_name}\nЗапись через kogDA`,
        startISO: startTime.toISOString(),
        endISO: endTime.toISOString(),
        timezone: clientTz,
      }).then(async result => {
        if (!result.ok) {
          console.error(`[booking ${booking.id}] Google event skip: ${result.reason}`)
          return
        }
        try {
          await pool.query(
            `UPDATE bookings SET google_event_id = $1, google_calendar_id = $2 WHERE id = $3`,
            [result.eventId, result.calendarId, booking.id]
          )
        } catch (err) {
          console.error(`[booking ${booking.id}] save google_event_id failed:`, err.message)
        }
      })
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

// Коуч подтверждает новую бронь. Бизнес-логика (CAS-UPDATE, email, Google-
// событие) — в bookingLifecycle.confirmBooking, общий код с telegram.js.
router.patch("/:id/confirm", auth, async (req, res) => {
  try {
    const r = await confirmBooking(req.params.id)
    if (r.code === 'not_found') return res.status(404).json({ error: 'Not found' })
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
// Б.2 рефакторинг: бизнес-логика (UPDATE + email клиенту) — в
// bookingLifecycle.cancelBooking, общая с telegram.js (callback reject_booking_).
// Owner-check остаётся ЗДЕСЬ (вне helper) — боту он не нужен.
// notifyBookingCancelled (Telegram коучу) остаётся ЗДЕСЬ — web шлёт новое
// сообщение, бот редактирует существующее, поведение не унифицируется.
//
// ПОРЯДОК ОПЕРАЦИЙ ИЗМЕНИЛСЯ относительно прежнего web-кода:
//   Было:  SELECT → owner-check → notify(TG) → email → UPDATE
//   Стало: SELECT → owner-check → cancelBooking(UPDATE → email) → notify(TG)
// То есть Telegram-уведомление коучу теперь приходит ПОСЛЕ email клиенту и
// ПОСЛЕ UPDATE (раньше — до). Семантика та же, конечное состояние идентично.
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    // Owner-check: нужен ДО helper. Достаём только user_id брони.
    const ownerResult = await pool.query(
      'SELECT mt.user_id FROM bookings b JOIN meeting_types mt ON b.meeting_type_id = mt.id WHERE b.id = $1',
      [req.params.id]
    )
    if (ownerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' })
    }
    if (ownerResult.rows[0].user_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Бизнес-логика: UPDATE + email клиенту (см. cancelBooking).
    const r = await cancelBooking(req.params.id)
    if (r.code === 'not_found') {
      // Гонка: бронь удалили между owner-check и helper. Крайне маловероятно.
      return res.status(404).json({ error: 'Not found' })
    }

    // Telegram коучу — web-специфично, вне helper.
    const startDate = new Date(r.booking.start_time)
    const dateRu = startDate.toLocaleDateString('ru-RU')
    const timeRu = startDate.toTimeString().slice(0, 5)
    notifyBookingCancelled(r.booking.client_name, r.meeting.title, dateRu, timeRu, r.meeting.user_id)

    res.json({ success: true })
  } catch (err) {
    console.error('[bookings cancel]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Коуч просит клиента перенести встречу.
// Бронь → 'cancelled' (слот освобождается), клиенту уходит мягкое письмо
// с приглашением выбрать новое время на публичной странице коуча.
// Клиент перезаписывается заново через обычный флоу. Решение 17.05.2026.
router.patch('/:id/cancel-reschedule', auth, async (req, res) => {
  try {
    const bookingResult = await pool.query(
      `SELECT b.*, mt.title as meeting_title, mt.user_id, u.name as expert_name, u.slug as expert_slug
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

    sendBookingRescheduleRequestByCoachEmail(
      booking.client_email,
      booking.client_name,
      booking.meeting_title,
      dateIso,
      timeRu,
      booking.expert_name,
      booking.expert_slug
    )

    await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', ['cancelled', req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error('[bookings cancel-reschedule]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router