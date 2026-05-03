const TelegramBot = require('node-telegram-bot-api')

const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN)
  : null

const CHAT_ID = process.env.TELEGRAM_CHAT_ID

const send = async (message) => {
  if (!bot || !CHAT_ID) return
  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' })
  } catch (err) {
    console.error('Telegram error:', err.message)
  }
}

// Новая бронь
const notifyNewBooking = async (booking, meetingTitle, clientName, clientEmail, date, time) => {
  await send(`
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
const notifyBookingCancelled = async (clientName, meetingTitle, date, time) => {
  await send(`
❌ <b>Бронь отменена</b>

👤 <b>Клиент:</b> ${clientName}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}

Слот снова свободен.
  `)
}

// Напоминание за 24 часа
const notifyReminder24h = async (clientName, meetingTitle, date, time, videoLink) => {
  await send(`
⏰ <b>Напоминание — встреча завтра!</b>

👤 <b>Клиент:</b> ${clientName}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}
📹 <b>Видеозвонок:</b> ${videoLink}
  `)
}

// Напоминание за 1 час
const notifyReminder1h = async (clientName, meetingTitle, time, videoLink) => {
  await send(`
🔔 <b>Встреча через час!</b>

👤 <b>Клиент:</b> ${clientName}
📅 <b>Встреча:</b> ${meetingTitle}
⏰ <b>Время:</b> ${time}
📹 <b>Ссылка:</b> ${videoLink}
  `)
}

// Утренняя сводка
const notifyDailySummary = async (bookings) => {
  if (bookings.length === 0) {
    await send(`☀️ <b>Доброе утро!</b>\n\nСегодня встреч нет. Свободный день! 🌴`)
    return
  }
  const list = bookings.map(b => `• ${b.time} — ${b.client_name} (${b.meeting_title})`).join('\n')
  await send(`
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