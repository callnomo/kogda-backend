const TelegramBot = require('node-telegram-bot-api')

const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN)
  : null

const CHAT_ID = process.env.TELEGRAM_CHAT_ID

const sendNotification = async (message) => {
  if (!bot || !CHAT_ID) {
    console.log('Telegram not configured')
    return
  }
  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' })
  } catch (err) {
    console.error('Telegram error:', err.message)
  }
}

const notifyNewBooking = async (booking, meetingTitle, clientName, clientEmail, date, time) => {
  const message = `
🎉 <b>Новая запись!</b>

👤 <b>Клиент:</b> ${clientName}
📧 <b>Email:</b> ${clientEmail}
📅 <b>Встреча:</b> ${meetingTitle}
🗓 <b>Дата:</b> ${date}
⏰ <b>Время:</b> ${time}
📹 <b>Видеозвонок:</b> ${booking.video_link}
  `
  await sendNotification(message)
}

module.exports = { notifyNewBooking }