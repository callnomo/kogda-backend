const TelegramBot = require('node-telegram-bot-api')
const pool = require('./db')
// Рефакторинг Б: общая бизнес-логика подтверждения брони (и далее — отмены/
// переноса). См. src/bookingLifecycle.js. Шаг Б.1 — confirmBooking.
const { confirmBooking, cancelBooking, confirmReschedule, rejectReschedule } = require('./bookingLifecycle')

const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: { autoStart: true, params: { timeout: 10 } } })
  : null

if (bot) {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id
    const text = msg.text || ''

    if (text.startsWith('/start')) {
      const parts = text.split(' ')
      const token = parts[1]

      if (token) {
        try {
          const result = await pool.query(
            'UPDATE users SET telegram_chat_id = $1 WHERE telegram_token = $2 RETURNING name',
            [chatId.toString(), token]
          )
          if (result.rows.length > 0) {
            bot.sendMessage(chatId, `🎉 Отлично, ${result.rows[0].name}! Telegram подключён. Теперь ты будешь получать уведомления о новых бронированиях здесь.`)
          } else {
            bot.sendMessage(chatId, 'Токен не найден. Попробуй снова через дашборд kogDA.')
          }
        } catch (err) {
          console.error('Telegram connect error:', err)
        }
      } else {
        bot.sendMessage(chatId, `👋 Привет! Я бот kogDA.\n\nЧтобы подключить уведомления, зайди в свой дашборд на app.kogda.app и нажми "Подключить Telegram".`)
      }
    }
  })

  // Inline кнопки
  bot.on('callback_query', async (query) => {
    const data = query.data
    const chatId = query.message.chat.id
    const messageId = query.message.message_id

    try {
      // Подтвердить новую бронь — общая логика в bookingLifecycle.confirmBooking
      // (CAS-UPDATE, email, Google-событие). Бот здесь только редактирует
      // inline-сообщение в чате на "✅ Встреча подтверждена!".
      if (data.startsWith('confirm_booking_')) {
        const bookingId = data.replace('confirm_booking_', '')
        const r = await confirmBooking(bookingId)
        // r.meeting != null только при РЕАЛЬНОМ переходе pending→confirmed
        // (см. bookingLifecycle.confirmBooking). На no-op (бронь уже была
        // confirmed/cancelled) helper вернёт r.ok=true, r.meeting=null —
        // сообщение в чате не переписываем, чтобы не врать об отменённой броне.
        if (r.ok && r.meeting) {
          const booking = r.booking
          bot.editMessageText(`✅ <b>Встреча подтверждена!</b>\n\n👤 ${booking.client_name}\n🗓 ${new Date(booking.start_time).toLocaleDateString('ru-RU')} в ${new Date(booking.start_time).toTimeString().slice(0,5)}\n\nКлиент получил письмо с подтверждением.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
        }
      }

      // Отклонить новую бронь — общая логика в bookingLifecycle.cancelBooking
      // (UPDATE status='cancelled' + email клиенту). Бот здесь только
      // редактирует inline-сообщение на "❌ Встреча отклонена.".
      else if (data.startsWith('reject_booking_')) {
        const bookingId = data.replace('reject_booking_', '')
        const r = await cancelBooking(bookingId)
        if (r.ok && r.meeting) {
          const booking = r.booking
          bot.editMessageText(`❌ <b>Встреча отклонена.</b>\n\n👤 ${booking.client_name} получил письмо об отмене.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
        }
      }

      // Подтвердить перенос — общая логика в bookingLifecycle.confirmReschedule
      // (SELECT + расчёт newEndTime + UPDATE). Бот здесь только редактирует
      // сообщение на "✅ Перенос подтверждён!". Текст 1-в-1 как раньше; в
      // источнике даты — booking.start_time (после UPDATE равен старому
      // reschedule_time), печатаемая строка идентична прежней.
      else if (data.startsWith('confirm_reschedule_')) {
        const bookingId = data.replace('confirm_reschedule_', '')
        const r = await confirmReschedule(bookingId)
        if (r.ok && r.meeting) {
          const booking = r.booking
          bot.editMessageText(`✅ <b>Перенос подтверждён!</b>\n\n👤 ${booking.client_name}\n🗓 ${new Date(booking.start_time).toLocaleDateString('ru-RU')} в ${new Date(booking.start_time).toTimeString().slice(0,5)}`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
        }
      }

      // Отклонить перенос — общая логика в bookingLifecycle.rejectReschedule
      // (SELECT + UPDATE). Бот здесь только редактирует сообщение на
      // "❌ Перенос отклонён.". Текст 1-в-1 как раньше.
      else if (data.startsWith('reject_reschedule_')) {
        const bookingId = data.replace('reject_reschedule_', '')
        const r = await rejectReschedule(bookingId)
        if (r.ok && r.meeting) {
          bot.editMessageText(`❌ <b>Перенос отклонён.</b>\n\nВстреча остаётся в прежнее время.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
        }
      }

      bot.answerCallbackQuery(query.id)
    } catch (err) {
      console.error('Callback error:', err)
      bot.answerCallbackQuery(query.id, { text: 'Ошибка' })
    }
  })

  bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err.message)
  })
}

const sendToUser = async (chatId, message, options = {}) => {
  if (!bot || !chatId) return
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', ...options })
  } catch (err) {
    console.error('Telegram send error:', err.message)
  }
}

const getUserChatId = async (userId) => {
  if (!userId) return null
  try {
    const result = await pool.query(
      'SELECT telegram_chat_id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    )
    return result.rows[0]?.telegram_chat_id || null
  } catch {
    return null
  }
}

const notifyNewBooking = async (booking, meetingTitle, clientName, clientEmail, date, time, userId, requireConfirm = false) => {
  const chatId = await getUserChatId(userId)
  const message = `
🎉 <b>${requireConfirm ? 'Новая заявка — требует подтверждения!' : 'Новая запись!'}</b>

👤 <b>Клиент:</b> ${clientName}
📧 <b>Email:</b> ${clientEmail}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}
📹 <b>Видеозвонок:</b> ${booking.video_link}
  `

  if (requireConfirm) {
    await sendToUser(chatId, message, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Подтвердить', callback_data: `confirm_booking_${booking.id}` },
          { text: '❌ Отклонить', callback_data: `reject_booking_${booking.id}` }
        ]]
      }
    })
  } else {
    await sendToUser(chatId, message)
  }
}

const notifyBookingCancelled = async (clientName, meetingTitle, date, time, userId) => {
  const chatId = await getUserChatId(userId)
  await sendToUser(chatId, `
❌ <b>Бронь отменена</b>

👤 <b>Клиент:</b> ${clientName}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}

Слот снова свободен.
`)
}

const notifyReminder24h = async (clientName, meetingTitle, date, time, videoLink, userId) => {
  const chatId = await getUserChatId(userId)
  await sendToUser(chatId, `
⏰ <b>Напоминание — встреча завтра!</b>

👤 <b>Клиент:</b> ${clientName}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}
📹 <b>Видеозвонок:</b> ${videoLink}
  `)
}

const notifyReminder1h = async (clientName, meetingTitle, time, videoLink, userId) => {
  const chatId = await getUserChatId(userId)
  await sendToUser(chatId, `
🔔 <b>Встреча через час!</b>

👤 <b>Клиент:</b> ${clientName}
📅 <b>Встреча:</b> ${meetingTitle}
⏰ <b>Время:</b> ${time}
📹 <b>Ссылка:</b> ${videoLink}
  `)
}

const notifyDailySummary = async (bookings, userId) => {
  const chatId = await getUserChatId(userId)
  if (bookings.length === 0) {
    await sendToUser(chatId, `☀️ <b>Доброе утро!</b>\n\nСегодня встреч нет. Свободный день! 🌴`)
    return
  }
  const list = bookings.map(b => `• ${b.time} — ${b.client_name} (${b.meeting_title})`).join('\n')
  await sendToUser(chatId, `
☀️ <b>Доброе утро! Сегодня у тебя ${bookings.length} ${bookings.length === 1 ? 'встреча' : 'встреч'}:</b>

${list}
  `)
}

const notifyRescheduleRequest = async (clientName, meetingTitle, newDate, newTime, bookingId, userId) => {
  const chatId = await getUserChatId(userId)
  await sendToUser(chatId, `
🔄 <b>Запрос на перенос!</b>

👤 <b>Клиент:</b> ${clientName}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Новая дата:</b> ${newDate}
⏰ <b>Новое время:</b> ${newTime}
  `, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Подтвердить', callback_data: `confirm_reschedule_${bookingId}` },
        { text: '❌ Отклонить', callback_data: `reject_reschedule_${bookingId}` }
      ]]
    }
  })
}

// НОВОЕ: коучу — висит pending-запрос, ждёт ответа.
// Шлётся по триггерам из cron (защита от дублей через pending_reminder_sent_at).
// Inline-кнопки confirm/reject переиспользуют существующие обработчики callback_query.
const notifyPendingReminder = async (clientName, clientEmail, meetingTitle, date, time, bookingId, userId) => {
  const chatId = await getUserChatId(userId)
  await sendToUser(chatId, `
⏳ <b>Запрос ждёт ответа</b>

👤 <b>Клиент:</b> ${clientName}
📧 <b>Email:</b> ${clientEmail}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}

Если не ответить — запрос отменится автоматически после времени встречи.
  `, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Подтвердить', callback_data: `confirm_booking_${bookingId}` },
        { text: '❌ Отклонить', callback_data: `reject_booking_${bookingId}` }
      ]]
    }
  })
}

// НОВОЕ: коучу — pending-запрос истёк и отменён автоматически.
// Шлётся из cron когда время встречи прошло, а коуч так и не ответил.
const notifyBookingExpired = async (clientName, meetingTitle, date, time, userId) => {
  const chatId = await getUserChatId(userId)
  await sendToUser(chatId, `
⌛ <b>Запрос истёк и отменён</b>

👤 <b>Клиент:</b> ${clientName}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}

Запрос не был подтверждён вовремя, время встречи прошло. Клиент получил уведомление по email.
  `)
}

module.exports = {
  notifyNewBooking,
  notifyBookingCancelled,
  notifyRescheduleRequest,
  notifyReminder24h,
  notifyReminder1h,
  notifyDailySummary,
  notifyPendingReminder,
  notifyBookingExpired
}