const cron = require('node-cron')
const pool = require('./db')
const { notifyReminder24h, notifyReminder1h, notifyDailySummary } = require('./telegram')

// Утренняя сводка — каждый день в 9:00
cron.schedule('0 9 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0]
    const result = await pool.query(
      `SELECT b.*, mt.title as meeting_title, u.id as user_id
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       JOIN users u ON mt.user_id = u.id
       WHERE DATE(b.start_time) = $1 AND b.status = 'confirmed'
       ORDER BY b.start_time`,
      [today]
    )
    const bookings = result.rows.map(b => ({
      time: new Date(b.start_time).toTimeString().slice(0, 5),
      client_name: b.client_name,
      meeting_title: b.meeting_title
    }))
    await notifyDailySummary(bookings)
  } catch (err) {
    console.error('Cron daily summary error:', err)
  }
}, { timezone: 'Asia/Bangkok' })

// Напоминание за 24 часа — каждый час проверяем
cron.schedule('0 * * * *', async () => {
  try {
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const from = new Date(in24h.getTime() - 30 * 60 * 1000)
    const to = new Date(in24h.getTime() + 30 * 60 * 1000)

    const result = await pool.query(
      `SELECT b.*, mt.title as meeting_title
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE b.start_time BETWEEN $1 AND $2 AND b.status = 'confirmed'`,
      [from, to]
    )

    for (const booking of result.rows) {
      const date = new Date(booking.start_time).toLocaleDateString('ru-RU')
      const time = new Date(booking.start_time).toTimeString().slice(0, 5)
      await notifyReminder24h(booking.client_name, booking.meeting_title, date, time, booking.video_link)
    }
  } catch (err) {
    console.error('Cron 24h reminder error:', err)
  }
})

// Напоминание за 1 час — каждые 30 минут проверяем
cron.schedule('*/30 * * * *', async () => {
  try {
    const in1h = new Date(Date.now() + 60 * 60 * 1000)
    const from = new Date(in1h.getTime() - 15 * 60 * 1000)
    const to = new Date(in1h.getTime() + 15 * 60 * 1000)

    const result = await pool.query(
      `SELECT b.*, mt.title as meeting_title
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE b.start_time BETWEEN $1 AND $2 AND b.status = 'confirmed'`,
      [from, to]
    )

    for (const booking of result.rows) {
      const time = new Date(booking.start_time).toTimeString().slice(0, 5)
      await notifyReminder1h(booking.client_name, booking.meeting_title, time, booking.video_link)
    }
  } catch (err) {
    console.error('Cron 1h reminder error:', err)
  }
})

console.log('Cron jobs запущены!')