require('./instrument')
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const Sentry = require('@sentry/node')
const pool = require('./db')
const authRoutes = require('./auth')
const meetingRoutes = require('./meetings')
const scheduleRoutes = require('./schedule')
const bookingRoutes = require('./bookings')
const settingsRoutes = require('./settings')

// Запускаем cron jobs
require('./cron')

const app = express()
app.set('trust proxy', 1)
app.use(cors())
app.use(express.json())

app.use('/auth', authRoutes)
app.use('/meetings', meetingRoutes)
app.use('/schedule', scheduleRoutes)
app.use('/bookings', bookingRoutes)
app.use('/settings', settingsRoutes)

app.get('/', (req, res) => {
  res.json({ message: 'kogDA API работает!' })
})

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()')
    res.json({ status: 'ok', db: 'connected' })
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected' })
  }
})

Sentry.setupExpressErrorHandler(app)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`kogDA сервер запущен на порту ${PORT}`)
})