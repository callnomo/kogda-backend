const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')
const { OAuth2Client } = require('google-auth-library')

// --- Конфиг из env (заданы в Railway) ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI
// Куда возвращаем коуча в кабинет после подключения/ошибки
const FRONTEND_URL = 'https://app.kogda.app'

// Scope: видеть и редактировать события календаря.
// Достаточно для проверки занятости (FreeBusy) и создания/удаления наших броней.
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events']

// Создаём OAuth-клиента Google
function makeOAuthClient() {
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
}

// --- Auth middleware (тот же паттерн, что в settings.js) ---
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = decoded.userId
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// =========================================================
// GET /integrations/status
// Какие календари подключены у текущего коуча (для отрисовки тумблеров)
// =========================================================
router.get('/status', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT provider, provider_email FROM calendar_connections WHERE user_id = $1`,
      [req.userId]
    )
    const status = { google: { connected: false, email: null } }
    for (const row of result.rows) {
      if (row.provider === 'google') {
        status.google = { connected: true, email: row.provider_email }
      }
    }
    res.json(status)
  } catch (err) {
    console.error('GET /integrations/status error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// =========================================================
// GET /integrations/google/connect
// Коуч (залогинен) жмёт "Подключить". Редиректим на согласие Google.
// JWT передаём в query (?token=...), т.к. это переход по ссылке, не fetch.
// Из него делаем короткоживущий подписанный state с userId.
// =========================================================
router.get('/google/connect', async (req, res) => {
  try {
    const jwtToken = req.query.token
    if (!jwtToken) return res.status(401).send('No token')

    let userId
    try {
      const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET)
      userId = decoded.userId
    } catch {
      return res.status(401).send('Invalid token')
    }

    // state = короткоживущий JWT (10 мин) с userId. Защита от CSRF + узнаём коуча в callback.
    const state = jwt.sign({ userId, purpose: 'google_oauth' }, process.env.JWT_SECRET, {
      expiresIn: '10m',
    })

    const oauth2 = makeOAuthClient()
    const url = oauth2.generateAuthUrl({
      access_type: 'offline', // чтобы получить refresh_token
      prompt: 'consent', // всегда показываем согласие — гарантирует refresh_token
      scope: GOOGLE_SCOPES,
      state,
    })

    res.redirect(url)
  } catch (err) {
    console.error('GET /integrations/google/connect error:', err)
    res.redirect(`${FRONTEND_URL}/settings?calendar=error`)
  }
})

// =========================================================
// GET /integrations/google/callback
// Сюда Google возвращает коуча после согласия (это redirect URI).
// Меняем code на токены, узнаём email, сохраняем в calendar_connections.
// =========================================================
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query

    // Коуч нажал "Отмена" на экране Google
    if (oauthError) {
      return res.redirect(`${FRONTEND_URL}/settings?calendar=cancelled`)
    }
    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/settings?calendar=error`)
    }

    // Проверяем state (подпись + срок) и достаём userId
    let userId
    try {
      const decoded = jwt.verify(state, process.env.JWT_SECRET)
      if (decoded.purpose !== 'google_oauth') throw new Error('bad purpose')
      userId = decoded.userId
    } catch {
      return res.redirect(`${FRONTEND_URL}/settings?calendar=error`)
    }

    const oauth2 = makeOAuthClient()

    // Меняем code на токены
    const { tokens } = await oauth2.getToken(code)
    const accessToken = tokens.access_token || null
    const refreshToken = tokens.refresh_token || null
    const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null

    // Узнаём email подключённого гугл-аккаунта (из id_token, без доп. запроса)
    let providerEmail = null
    try {
      if (tokens.id_token) {
        const ticket = await oauth2.verifyIdToken({
          idToken: tokens.id_token,
          audience: GOOGLE_CLIENT_ID,
        })
        providerEmail = ticket.getPayload()?.email || null
      }
    } catch {
      // не критично — email просто не покажем
    }

    // Сохраняем (UNIQUE user_id+provider — переподключение перезатирает строку)
    await pool.query(
      `INSERT INTO calendar_connections
         (user_id, provider, provider_email, access_token, refresh_token, token_expiry, updated_at)
       VALUES ($1, 'google', $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, provider) DO UPDATE SET
         provider_email = EXCLUDED.provider_email,
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, calendar_connections.refresh_token),
         token_expiry = EXCLUDED.token_expiry,
         updated_at = NOW()`,
      [userId, providerEmail, accessToken, refreshToken, expiry]
    )

    res.redirect(`${FRONTEND_URL}/settings?calendar=google_connected`)
  } catch (err) {
    console.error('GET /integrations/google/callback error:', err)
    res.redirect(`${FRONTEND_URL}/settings?calendar=error`)
  }
})

// =========================================================
// POST /integrations/google/disconnect
// Отключаем Google: отзываем токен у Google + удаляем строку из БД.
// =========================================================
router.post('/google/disconnect', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT access_token, refresh_token FROM calendar_connections
       WHERE user_id = $1 AND provider = 'google'`,
      [req.userId]
    )

    if (result.rows.length > 0) {
      const { access_token, refresh_token } = result.rows[0]
      // Пытаемся отозвать токен у Google (не критично если не выйдет)
      try {
        const oauth2 = makeOAuthClient()
        const tokenToRevoke = refresh_token || access_token
        if (tokenToRevoke) await oauth2.revokeToken(tokenToRevoke)
      } catch (e) {
        console.error('Google revoke failed (не критично):', e.message)
      }
    }

    await pool.query(
      `DELETE FROM calendar_connections WHERE user_id = $1 AND provider = 'google'`,
      [req.userId]
    )

    res.json({ success: true })
  } catch (err) {
    console.error('POST /integrations/google/disconnect error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router