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

// Scope: ТОЛЬКО доступность (свободен/занят) через FreeBusy.
// Google технически НЕ отдаёт нам названия/описания событий при этом scope —
// privacy-гарантия на стороне Google, не на нашей дисциплине.
// Самый узкий scope для нашей задачи (см. таблицу Calendar API scopes).
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.freebusy']

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

// =========================================================
// ===== ШАГ 2: УТИЛИТЫ ДЛЯ ЧТЕНИЯ ЗАНЯТОСТИ (FreeBusy) =====
// =========================================================
// Эти функции пока никто не вызывает в booking-флоу.
// Их подключит schedule.js на следующем шаге.
// Любая ошибка здесь НЕ должна ломать запись клиентов —
// поэтому getGoogleBusy при любом сбое возвращает [].
// =========================================================

// --- getFreshAccessToken(userId) ---
// Возвращает рабочий access_token коуча для Google API.
// Логика:
//  1. Берём строку из calendar_connections (provider='google').
//  2. Если Google не подключён — возвращаем null (это не ошибка).
//  3. Если access_token ещё живой (есть запас > 2 минут) — отдаём его как есть.
//  4. Если протух или скоро протухнет — обновляем через refresh_token,
//     записываем свежий access_token + expiry обратно в БД, отдаём новый.
//  5. Если обновить не удалось (refresh отозван и т.п.) — возвращаем null.
//     В этом случае синхра просто не применится, booking продолжит работать.
async function getFreshAccessToken(userId) {
  try {
    const result = await pool.query(
      `SELECT access_token, refresh_token, token_expiry
         FROM calendar_connections
        WHERE user_id = $1 AND provider = 'google'`,
      [userId]
    )

    if (result.rows.length === 0) {
      // У этого коуча Google не подключён — нечего синхронизировать
      return null
    }

    const row = result.rows[0]
    const accessToken = row.access_token
    const refreshToken = row.refresh_token
    const tokenExpiry = row.token_expiry ? new Date(row.token_expiry) : null

    // Запас 2 минуты: если токен протухнет в ближайшие 2 мин — считаем протухшим
    const SAFETY_MS = 2 * 60 * 1000
    const now = Date.now()
    const stillValid =
      accessToken &&
      tokenExpiry &&
      tokenExpiry.getTime() - now > SAFETY_MS

    if (stillValid) {
      return accessToken
    }

    // Нужно обновить. Без refresh_token обновить нельзя.
    if (!refreshToken) {
      console.error(`getFreshAccessToken: нет refresh_token у user ${userId}`)
      return null
    }

    const oauth2 = makeOAuthClient()
    oauth2.setCredentials({ refresh_token: refreshToken })

    // google-auth-library сам сходит к Google и вернёт свежий access_token
    const { credentials } = await oauth2.refreshAccessToken()
    const newAccessToken = credentials.access_token || null
    const newExpiry = credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : null

    if (!newAccessToken) {
      console.error(`getFreshAccessToken: refresh не вернул access_token, user ${userId}`)
      return null
    }

    // Сохраняем свежий токен обратно (refresh_token обычно не меняется,
    // но если Google прислал новый — обновим и его)
    await pool.query(
      `UPDATE calendar_connections
          SET access_token = $1,
              token_expiry = $2,
              refresh_token = COALESCE($3, refresh_token),
              updated_at = NOW()
        WHERE user_id = $4 AND provider = 'google'`,
      [newAccessToken, newExpiry, credentials.refresh_token || null, userId]
    )

    return newAccessToken
  } catch (err) {
    // Любой сбой (refresh отозван, сеть, БД) — не валим booking, просто null
    console.error(`getFreshAccessToken error (user ${userId}):`, err.message)
    return null
  }
}

// --- getGoogleBusy(userId, timeMinISO, timeMaxISO) ---
// Спрашивает у Google FreeBusy API: когда коуч занят в окне [timeMin, timeMax].
// Возвращает массив занятых интервалов: [{ start: ISO, end: ISO }, ...]
// FreeBusy по дизайну отдаёт ТОЛЬКО интервалы занятости, без названий
// событий — мы физически не получаем "что" за событие, только "занято".
//
// ВАЖНО: при ЛЮБОЙ проблеме (Google не подключён, токен мёртв, API упал,
// таймаут) возвращаем [] — это значит "занятости из Google нет",
// booking покажет слоты как раньше. Лучше так, чем сломать запись.
async function getGoogleBusy(userId, timeMinISO, timeMaxISO) {
  try {
    const accessToken = await getFreshAccessToken(userId)
    if (!accessToken) {
      // Google не подключён или токен не удалось обновить
      return []
    }

    // Прямой REST-запрос к Google FreeBusy.
    // Node 18+ на Railway имеет глобальный fetch.
    // AbortController — таймаут 5с, чтобы медленный Google не тормозил booking.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    let resp
    try {
      resp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin: timeMinISO,
          timeMax: timeMaxISO,
          items: [{ id: 'primary' }], // основной календарь коуча
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!resp || !resp.ok) {
      console.error(
        `getGoogleBusy: Google ответил ${resp ? resp.status : 'нет ответа'} (user ${userId})`
      )
      return []
    }

    const data = await resp.json()
    const busy = data?.calendars?.primary?.busy

    if (!Array.isArray(busy)) {
      return []
    }

    // Нормализуем: только валидные пары {start, end}
    return busy
      .filter(b => b && b.start && b.end)
      .map(b => ({ start: b.start, end: b.end }))
  } catch (err) {
    // Таймаут, сеть, парсинг — всё сюда. Booking не должен пострадать.
    console.error(`getGoogleBusy error (user ${userId}):`, err.message)
    return []
  }
}

// =========================================================
// ВРЕМЕННЫЙ тестовый endpoint (Шаг 2 проверки).
// Возвращает занятость текущего коуча из Google за указанный день.
// Нужен ТОЛЬКО чтобы глазами сверить с реальным Google-календарём.
// УДАЛИМ после успешной проверки, до встройки в booking.
// Не влияет на запись клиентов — отдельный путь, читает только.
// Пример: GET /integrations/_debug/freebusy?date=2026-05-19
// =========================================================
router.get('/_debug/freebusy', auth, async (req, res) => {
  try {
    const date = req.query.date // YYYY-MM-DD
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Передай ?date=YYYY-MM-DD' })
    }

    // Широкое окно: весь день +/- сутки, чтобы поймать сдвиги по tz
    const timeMin = `${date}T00:00:00.000Z`
    const timeMax = `${date}T23:59:59.999Z`

    const busy = await getGoogleBusy(req.userId, timeMin, timeMax)

    res.json({
      userId: req.userId,
      date,
      timeMin,
      timeMax,
      busy_count: busy.length,
      busy,
    })
  } catch (err) {
    console.error('GET /integrations/_debug/freebusy error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})


module.exports = router
module.exports.getFreshAccessToken = getFreshAccessToken
module.exports.getGoogleBusy = getGoogleBusy