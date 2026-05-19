// Общая бизнес-логика жизненного цикла брони. Вызывается ИЗ:
//  - src/bookings.js (HTTP-роуты PATCH /:id/...)
//  - src/telegram.js (callback_query inline-кнопок коуча)
//
// Зачем отдельный модуль: src/bookings.js уже require('./telegram'),
// поэтому helper нельзя класть туда же — будет цикл. Этот файл НЕ требует
// ./telegram (Telegram-уведомления коучу остаются у вызывающего, потому
// что web шлёт новое сообщение, а бот редактирует существующее in-place —
// это разный UX и не должно быть унифицировано). Также не знает про
// Express req/res — принимает id, возвращает структурированный результат.

const pool = require('./db')
const { sendBookingConfirmation } = require('./email')
const { createBookingEvent } = require('./integrations')

// confirmBooking(bookingId) — Шаг Б.1 рефакторинга.
// Подтверждает pending-бронь (status → 'confirmed') атомарно через CAS-UPDATE:
// перевод выполняется ТОЛЬКО если бронь сейчас в pending. Это защищает от:
//  - повторного нажатия "Подтвердить" (web + Telegram параллельно, разные
//    устройства, двойной клик и т.п.);
//  - случайного подтверждения уже отменённой брони.
//
// Побочные эффекты (email клиенту + Google-событие) выполняются ТОЛЬКО
// при реальном переходе pending → confirmed. На повторный вызов CAS
// вернёт 0 строк, helper отдаст { ok:true, meeting:null } и ничего не сделает.
//
// Возвращает:
//   { ok:false, code:'not_found', booking:null, meeting:null } — брони нет
//   { ok:true,  code:'ok', booking, meeting:{title,user_id,expert_name} } — реальный переход
//   { ok:true,  code:'ok', booking, meeting:null } — уже confirmed/cancelled, CAS no-op
async function confirmBooking(bookingId) {
  // 1) Есть ли вообще такая бронь — нужен для отличия 404 от no-op.
  const current = await pool.query(
    'SELECT * FROM bookings WHERE id = $1',
    [bookingId]
  )
  if (current.rows.length === 0) {
    return { ok: false, code: 'not_found', booking: null, meeting: null }
  }

  // 2) CAS-UPDATE: переходим в confirmed ТОЛЬКО из pending.
  //    Если в текущем статусе не pending — RETURNING вернёт 0 строк,
  //    мы выйдем по ветке "no-op" без побочных эффектов.
  const upd = await pool.query(
    "UPDATE bookings SET status = 'confirmed' WHERE id = $1 AND status = 'pending' RETURNING *",
    [bookingId]
  )

  if (upd.rows.length === 0) {
    // Бронь существует, но не в pending. Это валидный случай — повторное
    // нажатие на уже подтверждённую/отменённую бронь. Не ошибка. Не шлём
    // email и не создаём Google-событие повторно.
    return { ok: true, code: 'ok', booking: current.rows[0], meeting: null }
  }

  const booking = upd.rows[0]

  // 3) Подтягиваем title/expert_name (нужны для email) и user_id коуча
  //    (нужен для createBookingEvent). Одним SELECT-ом, как в текущем
  //    /confirm после шага C.3.
  const mr = await pool.query(
    'SELECT mt.title, mt.user_id, u.name as expert_name FROM meeting_types mt JOIN users u ON mt.user_id = u.id WHERE mt.id = $1',
    [booking.meeting_type_id]
  )
  const meeting = mr.rows[0] || null

  // Если meeting_type был удалён между бронированием и подтверждением —
  // редкий edge-case. Возвращаем ok без email/Google. Поведение совпадает
  // с текущим /confirm: внутренний `if (meetingResult.rows.length > 0)`
  // пропускал email/Google в этом случае.
  if (!meeting) {
    return { ok: true, code: 'ok', booking, meeting: null }
  }

  // 4) Email клиенту. Обёрнут в try/catch — бронь уже переведена в
  //    confirmed, упавший email не должен валить helper. Лог + продолжаем.
  try {
    const startDate = new Date(booking.start_time)
    const date = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`
    const time = `${String(startDate.getHours()).padStart(2,'0')}:${String(startDate.getMinutes()).padStart(2,'0')}`
    await sendBookingConfirmation(
      booking.client_email,
      booking.client_name,
      meeting.title,
      date,
      time,
      booking.video_link,
      meeting.expert_name,
      booking.client_token
    )
  } catch (err) {
    console.error(`[booking ${booking.id}] confirm email failed:`, err.message)
  }

  // 5) Google-событие — побочный эффект, не критический путь. Контракт
  //    ошибок такой же как раньше в /confirm: ни Google, ни последующий
  //    UPDATE event_id не должны валить helper. Только лог.
  const tz = booking.client_timezone || 'UTC'
  createBookingEvent(meeting.user_id, {
    summary: meeting.title,
    description: `Клиент: ${booking.client_name}\nЗапись через kogDA`,
    startISO: new Date(booking.start_time).toISOString(),
    endISO: new Date(booking.end_time).toISOString(),
    timezone: tz,
  }).then(async gResult => {
    if (!gResult.ok) {
      console.error(`[booking ${booking.id}] Google event skip on confirm: ${gResult.reason}`)
      return
    }
    try {
      await pool.query(
        `UPDATE bookings SET google_event_id = $1, google_calendar_id = $2 WHERE id = $3`,
        [gResult.eventId, gResult.calendarId, booking.id]
      )
    } catch (err) {
      console.error(`[booking ${booking.id}] save google_event_id on confirm failed:`, err.message)
    }
  })

  return { ok: true, code: 'ok', booking, meeting }
}

module.exports = { confirmBooking }
