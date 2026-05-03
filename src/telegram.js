const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: { autoStart: true, params: { timeout: 10 } } })
  : null
const pool = require('./db')

const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true })
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
      // Подтвердить новую бронь
      if (data.startsWith('confirm_booking_')) {
        const bookingId = data.replace('confirm_booking_', '')
        const result = await pool.query(
          'UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *',
          ['confirmed', bookingId]
        )
        if (result.rows.length > 0) {
          const booking = result.rows[0]
          const meetingResult = await pool.query(
            'SELECT mt.title, u.name as expert_name FROM meeting_types mt JOIN users u ON mt.user_id = u.id WHERE mt.id = $1',
            [booking.meeting_type_id]
          )
          if (meetingResult.rows.length > 0) {
            const { sendBookingConfirmation } = require('./email')
            const date = new Date(booking.start_time).toISOString().split('T')[0]
            const time = new Date(booking.start_time).toTimeString().slice(0, 5)
            sendBookingConfirmation(booking.client_email, booking.client_name, meetingResult.rows[0].title, date, time, booking.video_link, meetingResult.rows[0].expert_name, booking.client_token)
          }
          bot.editMessageText(`✅ <b>Встреча подтверждена!</b>\n\n👤 ${booking.client_name}\n🗓 ${new Date(booking.start_time).toLocaleDateString('ru-RU')} в ${new Date(booking.start_time).toTimeString().slice(0,5)}\n\nКлиент получил письмо с подтверждением.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
        }
      }

      // Отклонить новую бронь
      else if (data.startsWith('reject_booking_')) {
        const bookingId = data.replace('reject_booking_', '')
        const result = await pool.query(
          'UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *',
          ['cancelled', bookingId]
        )
        if (result.rows.length > 0) {
          const booking = result.rows[0]
          bot.editMessageText(`❌ <b>Встреча отклонена.</b>\n\n👤 ${booking.client_name} будет уведомлён об отмене.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
        }
      }

      // Подтвердить перенос
      else if (data.startsWith('confirm_reschedule_')) {
        const bookingId = data.replace('confirm_reschedule_', '')
        const bookingResult = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId])
        if (bookingResult.rows.length > 0) {
          const booking = bookingResult.rows[0]
          const meetingResult = await pool.query('SELECT duration FROM meeting_types WHERE id = $1', [booking.meeting_type_id])
          const duration = meetingResult.rows[0]?.duration || 60
          const newEndTime = new Date(new Date(booking.reschedule_time).getTime() + duration * 60000)
          await pool.query(
            'UPDATE bookings SET start_time = $1, end_time = $2, status = $3, reschedule_request = NULL, reschedule_time = NULL WHERE id = $4',
            [booking.reschedule_time, newEndTime, 'confirmed', bookingId]
          )
          bot.editMessageText(`✅ <b>Перенос подтверждён!</b>\n\n👤 ${booking.client_name}\n🗓 ${new Date(booking.reschedule_time).toLocaleDateString('ru-RU')} в ${new Date(booking.reschedule_time).toTimeString().slice(0,5)}`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
        }
      }

      // Отклонить перенос
      else if (data.startsWith('reject_reschedule_')) {
        const bookingId = data.replace('reject_reschedule_', '')
        await pool.query(
          'UPDATE bookings SET status = $1, reschedule_request = NULL, reschedule_time = NULL WHERE id = $2',
          ['confirmed', bookingId]
        )
        bot.editMessageText(`❌ <b>Перенос отклонён.</b>\n\nВстреча остаётся в прежнее время.`, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' })
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
  try {
    const result = await pool.query('SELECT telegram_chat_id FROM users WHERE id = $1', [userId])
    return result.rows[0]?.telegram_chat_id || process.env.TELEGRAM_CHAT_ID
  } catch {
    return process.env.TELEGRAM_CHAT_ID
  }
}

// Новая бронь
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

// Отмена брони
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

// Напоминание за 24 часа
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

// Напоминание за 1 час
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

// Утренняя сводка
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

// Запрос на перенос — с кнопками
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

module.exports = {
  notifyNewBooking,
  notifyBookingCancelled,
  notifyRescheduleRequest,
  notifyReminder24h,
  notifyReminder1h,
  notifyDailySummary
}