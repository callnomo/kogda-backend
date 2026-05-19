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
const { sendBookingConfirmation, sendBookingCancelledByCoachEmail } = require('./email')
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

// cancelBooking(bookingId) — Шаг Б.2 рефакторинга.
// Отменяет бронь (status → 'cancelled') из ЛЮБОГО текущего статуса.
// БЕЗ CAS-условия: сохраняем поведение обоих текущих путей (web /cancel и
// bot reject_booking_ — оба делают безусловный UPDATE status='cancelled').
//
// Что делает helper:
//   1) SELECT с JOIN — берём meeting_title, expert_name и user_id коуча.
//      Если брони нет — { ok:false, code:'not_found', ... }.
//   2) UPDATE status='cancelled' RETURNING * — обновлённая бронь возвращается
//      в booking.
//   3) Email клиенту sendBookingCancelledByCoachEmail в try/catch:
//      падение email НЕ должно ронять helper (бронь уже отменена).
//
// Чего helper НЕ делает (по плану):
//   - НЕ проверяет ownership (booking.user_id !== req.userId). Owner-check
//     остаётся СНАРУЖИ у вызывающего (web-роута), потому что telegram-боту
//     ownership-check не нужен (он работает только с chat_id коуча,
//     которого мы сами и нашли).
//   - НЕ шлёт notifyBookingCancelled (Telegram коучу). Это уведомление
//     web-специфичное: web шлёт новое сообщение коучу, а бот вместо этого
//     редактирует уже существующее сообщение через editMessageText. Разный
//     UX → не унифицируем, остаётся у вызывающего.
//
// Возвращает:
//   { ok:false, code:'not_found', booking:null, meeting:null } — брони нет
//   { ok:true,  code:'ok', booking, meeting:{title,user_id,expert_name} }
async function cancelBooking(bookingId) {
  const sel = await pool.query(
    `SELECT b.*, mt.title as meeting_title, mt.user_id, u.name as expert_name
     FROM bookings b
     JOIN meeting_types mt ON b.meeting_type_id = mt.id
     JOIN users u ON mt.user_id = u.id
     WHERE b.id = $1`,
    [bookingId]
  )
  if (sel.rows.length === 0) {
    return { ok: false, code: 'not_found', booking: null, meeting: null }
  }
  const row = sel.rows[0]

  const upd = await pool.query(
    "UPDATE bookings SET status = 'cancelled' WHERE id = $1 RETURNING *",
    [bookingId]
  )
  const booking = upd.rows[0]

  // Email клиенту. Формат date/time — 1-в-1 как в текущем web /cancel
  // (bookings.js: dateIso через get-методы; timeRu через toTimeString().slice(0,5))
  // и в текущем bot reject_booking_ (telegram.js): они уже идентичны.
  try {
    const startDate = new Date(booking.start_time)
    const dateIso = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`
    const timeRu = startDate.toTimeString().slice(0, 5)
    await sendBookingCancelledByCoachEmail(
      booking.client_email,
      booking.client_name,
      row.meeting_title,
      dateIso,
      timeRu,
      row.expert_name
    )
  } catch (err) {
    console.error(`[booking ${bookingId}] cancel email failed:`, err.message)
  }

  return {
    ok: true,
    code: 'ok',
    booking,
    meeting: {
      title: row.meeting_title,
      user_id: row.user_id,
      expert_name: row.expert_name,
    },
  }
}

// confirmReschedule(bookingId) — Шаг Б.3 рефакторинга.
// Коуч подтверждает запрошенный клиентом перенос: бронь переходит обратно в
// 'confirmed' с НОВЫМ временем (reschedule_time → start_time, новый end_time
// считается через mt.duration), поля reschedule_request/reschedule_time
// очищаются.
//
// Что делает helper (1-в-1 с прежним web-кодом и bot-веткой):
//   1) SELECT b.* по id. Нет → not_found.
//   2) SELECT mt.duration + meeting info (title, user_id, expert_name) JOIN.
//      duration берётся с fallback `|| 60` — поведение текущего кода.
//      Если meeting_type удалён — meeting:null, но действие выполняем
//      (как в текущем коде: `?.duration || 60` не падал).
//   3) newEndTime = reschedule_time + duration*60000.
//   4) UPDATE start_time, end_time, status='confirmed', reschedule_request=NULL,
//      reschedule_time=NULL RETURNING * → обновлённая бронь.
//
// Чего helper НЕ делает (по плану):
//   - НЕ шлёт email (для клиента это дыра, отдельный будущий шаг).
//   - НЕ трогает Google Calendar (отдельный будущий шаг #5).
//   - НЕ проверяет ownership (в текущем web-роуте owner-check ОТСУТСТВУЕТ,
//     поведение не меняем).
//
// Возвращает:
//   { ok:false, code:'not_found', booking:null, meeting:null }
//   { ok:true,  code:'ok', booking, meeting:{title,user_id,expert_name} }
//   { ok:true,  code:'ok', booking, meeting:null } — meeting_type удалён
//
// Примечание для вызывающих: в возвращённом booking поле reschedule_time = NULL
// (это уже пост-UPDATE состояние). Новое время встречи — в booking.start_time.
async function confirmReschedule(bookingId) {
  const sel = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId])
  if (sel.rows.length === 0) {
    return { ok: false, code: 'not_found', booking: null, meeting: null }
  }
  const before = sel.rows[0]

  const mr = await pool.query(
    'SELECT mt.duration, mt.title, mt.user_id, u.name as expert_name FROM meeting_types mt JOIN users u ON mt.user_id = u.id WHERE mt.id = $1',
    [before.meeting_type_id]
  )
  const meetingRow = mr.rows[0] || null
  const duration = meetingRow?.duration || 60
  const newEndTime = new Date(new Date(before.reschedule_time).getTime() + duration * 60000)

  const upd = await pool.query(
    "UPDATE bookings SET start_time = $1, end_time = $2, status = 'confirmed', reschedule_request = NULL, reschedule_time = NULL WHERE id = $3 RETURNING *",
    [before.reschedule_time, newEndTime, bookingId]
  )
  const booking = upd.rows[0]

  const meeting = meetingRow ? {
    title: meetingRow.title,
    user_id: meetingRow.user_id,
    expert_name: meetingRow.expert_name,
  } : null

  return { ok: true, code: 'ok', booking, meeting }
}

// rejectReschedule(bookingId) — Шаг Б.4 рефакторинга.
// Коуч отклоняет запрошенный клиентом перенос: бронь остаётся в прежнее
// время, статус откатывается в 'confirmed', поля reschedule_request /
// reschedule_time очищаются.
//
// Что делает helper:
//   1) SELECT b.* по id. Нет → not_found.
//   2) SELECT meeting info JOIN (title, user_id, expert_name) — для возврата
//      вызывающему (нужен для условия `if (r.ok && r.meeting)` в боте и
//      для будущих писем — сейчас не используется).
//   3) UPDATE status='confirmed', reschedule_request=NULL, reschedule_time=NULL
//      RETURNING * → обновлённая бронь.
//
// Чего helper НЕ делает (по плану):
//   - НЕ шлёт email (для клиента это дыра №4 — отдельный будущий шаг).
//   - НЕ проверяет ownership (в текущем web-роуте owner-check ОТСУТСТВУЕТ,
//     поведение не меняем).
//
// Возвращает:
//   { ok:false, code:'not_found', booking:null, meeting:null }
//   { ok:true,  code:'ok', booking, meeting:{title,user_id,expert_name} }
//   { ok:true,  code:'ok', booking, meeting:null } — meeting_type удалён
async function rejectReschedule(bookingId) {
  const sel = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId])
  if (sel.rows.length === 0) {
    return { ok: false, code: 'not_found', booking: null, meeting: null }
  }
  const before = sel.rows[0]

  const mr = await pool.query(
    'SELECT mt.title, mt.user_id, u.name as expert_name FROM meeting_types mt JOIN users u ON mt.user_id = u.id WHERE mt.id = $1',
    [before.meeting_type_id]
  )
  const meetingRow = mr.rows[0] || null

  const upd = await pool.query(
    "UPDATE bookings SET status = 'confirmed', reschedule_request = NULL, reschedule_time = NULL WHERE id = $1 RETURNING *",
    [bookingId]
  )
  const booking = upd.rows[0]

  const meeting = meetingRow ? {
    title: meetingRow.title,
    user_id: meetingRow.user_id,
    expert_name: meetingRow.expert_name,
  } : null

  return { ok: true, code: 'ok', booking, meeting }
}

module.exports = { confirmBooking, cancelBooking, confirmReschedule, rejectReschedule }
