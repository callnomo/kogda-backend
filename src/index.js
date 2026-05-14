require('dotenv').config()
require('./instrument')
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

// CORS с credentials — нужно для отправки/приёма httpOnly cookie trusted_device_token
// Разрешаем конкретные origins (с протоколом, без слеша на конце)
const ALLOWED_ORIGINS = [
  'https://app.kogda.app',
  'https://kogda.app',
  'http://localhost:3000', // локальная разработка
]

app.use(cors({
  origin: (origin, callback) => {
    // origin может быть undefined для same-origin запросов или curl/Postman — пропускаем
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    callback(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
}))

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

const { runMigrations } = require('./runMigrations')
const { backfillMeetingSlugs } = require('./backfillSlugs')
const { backfillSortOrder } = require('./backfillSortOrder')

const PORT = process.env.PORT || 3000

runMigrations()
  .then(() => backfillMeetingSlugs())
  .then(() => backfillSortOrder())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`kogDA сервер запущен на порту ${PORT}`)
    })
  })
  .catch((err) => {
    console.error('[startup] Не удалось применить миграции:', err)
    process.exit(1)
  })