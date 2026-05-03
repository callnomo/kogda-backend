const TelegramBot = require('node-telegram-bot-api')
const pool = require('./db')

const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true })
  : null

// Обработка команды /start с токеном
if (bot) {
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id
    const text = msg.text || ''

    if (text.startsWith('/start')) {
      const parts = text.split(' ')
      const token = parts[1]

      if (token) {
        // Ищем пользователя по токену
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

  bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err.message)
  })
}

const sendToUser = async (chatId, message) => {
  if (!bot || !chatId) return
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML' })
  } catch (err) {
    console.error('Telegram send error:', err.message)
  }
}

// Получить chat_id коуча по user_id
const getUserChatId = async (userId) => {
  try {
    const result = await pool.query('SELECT telegram_chat_id FROM users WHERE id = $1', [userId])
    return result.rows[0]?.telegram_chat_id || process.env.TELEGRAM_CHAT_ID
  } catch {
    return process.env.TELEGRAM_CHAT_ID
  }
}

// Новая бронь
const notifyNewBooking = async (booking, meetingTitle, clientName, clientEmail, date, time, userId) => {
  const chatId = await getUserChatId(userId)
  await sendToUser(chatId, `
🎉 <b>Новая запись!</b>

👤 <b>Клиент:</b> ${clientName}
📧 <b>Email:</b> ${clientEmail}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}
📹 <b>Видеозвонок:</b> ${booking.video_link}
  `)
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

module.exports = {
  notifyNewBooking,
  notifyBookingCancelled,
  notifyReminder24h,
  notifyReminder1h,
  notifyDailySummary
}