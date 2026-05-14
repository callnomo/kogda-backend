const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const pool = require('./db')
const {
  sendResetPasswordEmail,
  sendVerificationCode,
  sendEmailTakenWarning,
  sendBookingCancelledByCoachEmail,
  sendAccountDeletionEmail,
  sendEmailChangeCode,
  sendEmailChangedNotification,
  sendLoginVerificationCode,
  sendNewDeviceLoginNotification,
} = require('./email')
const {
  loginLimiter,
  requestCodeLimiter,
  verifyCodeLimiter,
  completeRegistrationLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  changePasswordLimiter,
  deleteAccountLimiter,
  requestEmailChangeLimiter,
  verifyEmailChangeLimiter,
  verifyLoginCodeLimiter,
  resendLoginCodeLimiter,
} = require('./rateLimiters')
const { logSecurityEvent } = require('./securityLog')

const normalizeEmail = (email) => (email || '').trim().toLowerCase()

const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function generateUniqueSlug() {
  for (let i = 0; i < 5; i++) {
    const random = crypto.randomBytes(4).toString('hex').slice(0, 7)
    const slug = `user-${random}`
    const exists = await pool.query('SELECT id FROM users WHERE slug = $1', [slug])
    if (exists.rows.length === 0) return slug
  }
  return `user-${crypto.randomBytes(4).toString('hex').slice(0, 7)}-${Date.now().toString(36)}`
}

// ============================================================================
// ===== ХЕЛПЕРЫ ДЛЯ TRUSTED DEVICES =====
// ============================================================================

const TRUSTED_DEVICE_DAYS = 90

// Парсер user-agent → "iPhone Safari", "Mac Chrome" и т.д.
function parseUserAgent(ua) {
  if (!ua) return 'Неизвестное устройство'
  ua = String(ua)

  // Платформа
  let platform = 'Устройство'
  if (/iPhone/i.test(ua)) platform = 'iPhone'
  else if (/iPad/i.test(ua)) platform = 'iPad'
  else if (/Android/i.test(ua)) platform = 'Android'
  else if (/Macintosh|Mac OS X/i.test(ua)) platform = 'Mac'
  else if (/Windows/i.test(ua)) platform = 'Windows'
  else if (/Linux/i.test(ua)) platform = 'Linux'

  // Браузер (порядок важен: проверяем edge раньше chrome, opera раньше chrome)
  let browser = ''
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome'
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari'

  return browser ? `${platform} ${browser}` : platform
}

// Получаем локацию из Cloudflare заголовков
function getLocationFromRequest(req) {
  const city = req.headers['cf-ipcity'] || null
  const country = req.headers['cf-ipcountry'] || null
  // Декодируем URL-encoded (Cloudflare шлёт "St. Petersburg" как "St.%20Petersburg")
  const decodedCity = city ? decodeURIComponent(city) : null
  return {
    city: decodedCity,
    country: country && country !== 'XX' ? country : null,
  }
}

// Получаем IP клиента
function getClientIp(req) {
  return req.headers['cf-connecting-ip'] ||
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.socket?.remoteAddress ||
         null
}

// Создаёт запись trusted device и возвращает device_token для cookie
async function createTrustedDevice(userId, req) {
  const ua = req.headers['user-agent'] || ''
  const { city, country } = getLocationFromRequest(req)
  const ip = getClientIp(req)
  const deviceLabel = parseUserAgent(ua)
  const deviceToken = crypto.randomBytes(48).toString('hex')
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000)

  await pool.query(`
    INSERT INTO trusted_devices
      (user_id, device_token, user_agent, device_label, last_ip, last_city, last_country, last_used_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
  `, [userId, deviceToken, ua, deviceLabel, ip, city, country, expiresAt])

  return { deviceToken, deviceLabel, city, country, ip }
}

// Проверяет cookie на валидность. Возвращает { valid, deviceId } или null
async function checkTrustedDevice(userId, deviceToken) {
  if (!deviceToken) return null
  const result = await pool.query(
    'SELECT id, expires_at FROM trusted_devices WHERE user_id = $1 AND device_token = $2',
    [userId, deviceToken]
  )
  if (result.rows.length === 0) return null
  const device = result.rows[0]
  if (new Date(device.expires_at) < new Date()) {
    // Истёк — чистим
    await pool.query('DELETE FROM trusted_devices WHERE id = $1', [device.id])
    return null
  }
  return { valid: true, deviceId: device.id }
}

// Обновляет last_used_at + IP/локацию при успешном использовании
async function touchTrustedDevice(deviceId, req) {
  const { city, country } = getLocationFromRequest(req)
  const ip = getClientIp(req)
  await pool.query(
    'UPDATE trusted_devices SET last_used_at = NOW(), last_ip = $1, last_city = $2, last_country = $3 WHERE id = $4',
    [ip, city, country, deviceId]
  )
}

// Парсит конкретное значение cookie из заголовка `Cookie`
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

// Ставит cookie руками через Set-Cookie header
function setTrustedCookie(res, token) {
  const maxAge = TRUSTED_DEVICE_DAYS * 24 * 60 * 60 // секунды
  const isProd = process.env.NODE_ENV === 'production'
  const parts = [
    `trusted_device_token=${token}`,
    `Max-Age=${maxAge}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
  ]
  if (isProd) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

// ===== ШАГ 1: Запросить код =====
router.post('/request-code', requestCodeLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email)
  if (!email) {
    return res.status(400).json({ error: 'Введи email' })
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [email]
    )

    if (existing.rows.length > 0) {
      await sendEmailTakenWarning(email)
      logSecurityEvent(req, { event: 'register_email_taken', email, success: false })
      return res.json({ success: true })
    }

    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await pool.query(`
      INSERT INTO pending_registrations (email, code, code_expires_at, attempts, created_at)
      VALUES ($1, $2, $3, 0, NOW())
      ON CONFLICT (email)
      DO UPDATE SET code = $2, code_expires_at = $3, attempts = 0, created_at = NOW()
    `, [email, code, expiresAt])

    await sendVerificationCode(email, code)
    logSecurityEvent(req, { event: 'register_code_requested', email })
    res.json({ success: true })
  } catch (err) {
    console.error('request-code error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== ШАГ 2: Проверить код =====
router.post('/verify-code', verifyCodeLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email)
  const { code } = req.body

  if (!email || !code) {
    return res.status(400).json({ error: 'Заполни поля' })
  }

  try {
    const result = await pool.query(
      'SELECT * FROM pending_registrations WHERE email = $1',
      [email]
    )

    if (result.rows.length === 0) {
      logSecurityEvent(req, { event: 'register_code_failed', email, success: false, metadata: { reason: 'no_pending' } })
      return res.status(400).json({ error: 'Запроси код заново' })
    }

    const pending = result.rows[0]

    if (new Date(pending.code_expires_at) < new Date()) {
      await pool.query('DELETE FROM pending_registrations WHERE email = $1', [email])
      logSecurityEvent(req, { event: 'register_code_failed', email, success: false, metadata: { reason: 'expired' } })
      return res.status(400).json({ error: 'Код устарел. Запроси новый.', expired: true })
    }

    if (pending.attempts >= 3) {
      await pool.query('DELETE FROM pending_registrations WHERE email = $1', [email])
      logSecurityEvent(req, { event: 'register_code_failed', email, success: false, metadata: { reason: 'too_many_attempts' } })
      return res.status(400).json({ error: 'Слишком много попыток. Запроси код заново.', expired: true })
    }

    if (pending.code !== code.toString()) {
      await pool.query(
        'UPDATE pending_registrations SET attempts = attempts + 1 WHERE email = $1',
        [email]
      )
      const remaining = 2 - pending.attempts
      logSecurityEvent(req, { event: 'register_code_failed', email, success: false, metadata: { reason: 'wrong_code', attempts: pending.attempts + 1 } })
      return res.status(400).json({
        error: `Неверный код. Осталось попыток: ${remaining}`
      })
    }

    const tempToken = jwt.sign(
      { email, purpose: 'complete-registration' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    )

    logSecurityEvent(req, { event: 'register_code_verified', email })
    res.json({ success: true, tempToken })
  } catch (err) {
    console.error('verify-code error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== ШАГ 3: Завершить регистрацию =====
router.post('/complete-registration', completeRegistrationLimiter, async (req, res) => {
  const { tempToken, name, password } = req.body

  if (!tempToken || !name || !password) {
    return res.status(400).json({ error: 'Заполни все поля' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть минимум 8 символов' })
  }
  if (!/[a-zA-Zа-яА-Я]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ error: 'Пароль должен содержать буквы и цифры' })
  }

  try {
    let decoded
    try {
      decoded = jwt.verify(tempToken, process.env.JWT_SECRET)
    } catch {
      return res.status(400).json({ error: 'Сессия истекла. Начни регистрацию заново.', expired: true })
    }

    if (decoded.purpose !== 'complete-registration') {
      return res.status(400).json({ error: 'Неверный токен' })
    }

    const email = decoded.email

    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [email]
    )
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Этот email уже зарегистрирован' })
    }

    const slug = await generateUniqueSlug()
    const hashedPassword = await bcrypt.hash(password, 10)

    const result = await pool.query(
      'INSERT INTO users (name, email, password, slug) VALUES ($1, $2, $3, $4) RETURNING id, name, email, slug',
      [name, email, hashedPassword, slug]
    )

    await pool.query('DELETE FROM pending_registrations WHERE email = $1', [email])

    const user = result.rows[0]
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })

    // НОВОЕ: после регистрации этот девайс автоматически доверенный
    // (юзер только что прошёл email-верификацию)
    const { deviceToken } = await createTrustedDevice(user.id, req)
    setTrustedCookie(res, deviceToken)

    logSecurityEvent(req, { event: 'register_complete', userId: user.id, email })
    res.json({ token, user })
  } catch (err) {
    console.error('complete-registration error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== СТАРЫЙ /register — оставляем для обратной совместимости =====
router.post('/register', async (req, res) => {
  res.status(410).json({
    error: 'Регистрация теперь в два шага. Обнови страницу.',
    deprecated: true
  })
})

// ===== Логин =====
// Логика:
// 1. Проверяем email+пароль
// 2. Если deleted_at → восстанавливаем (как было)
// 3. НОВОЕ: проверяем trusted_device cookie
//    - Если есть и валиден → выдаём JWT, обновляем last_used
//    - Если нет → создаём pending_login, шлём код на email, возвращаем { requires_verification: true, user_id }
router.post('/login', loginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email)
  const { password } = req.body
  try {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email])
    if (result.rows.length === 0) {
      logSecurityEvent(req, { event: 'login_failed', email, success: false, metadata: { reason: 'user_not_found' } })
      return res.status(400).json({ error: 'Invalid email or password' })
    }
    const user = result.rows[0]

    // Восстановление удалённого аккаунта (старая логика)
    if (user.deleted_at) {
      const validPassword = await bcrypt.compare(password, user.password)
      if (!validPassword) {
        logSecurityEvent(req, { event: 'login_failed', userId: user.id, email, success: false, metadata: { reason: 'wrong_password_deleted_account' } })
        return res.status(400).json({ error: 'Invalid email or password' })
      }
      await pool.query(
        'UPDATE users SET deleted_at = NULL, scheduled_delete_at = NULL WHERE id = $1',
        [user.id]
      )
      // При восстановлении сразу создаём trusted device — юзер прошёл пароль
      const { deviceToken } = await createTrustedDevice(user.id, req)
      setTrustedCookie(res, deviceToken)

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })
      logSecurityEvent(req, { event: 'account_restored', userId: user.id, email })
      return res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, slug: user.slug },
        restored: true
      })
    }

    // Проверка пароля
    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) {
      logSecurityEvent(req, { event: 'login_failed', userId: user.id, email, success: false, metadata: { reason: 'wrong_password' } })
      return res.status(400).json({ error: 'Invalid email or password' })
    }

    // НОВОЕ: проверка trusted_device cookie (читаем вручную из заголовка)
    const cookieToken = parseCookie(req.headers.cookie, 'trusted_device_token')
    const trusted = await checkTrustedDevice(user.id, cookieToken)

    if (trusted) {
      // Устройство доверенное — пускаем сразу
      await touchTrustedDevice(trusted.deviceId, req)
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })
      logSecurityEvent(req, { event: 'login_success', userId: user.id, email, metadata: { trusted_device: true } })
      return res.json({ token, user: { id: user.id, name: user.name, email: user.email, slug: user.slug } })
    }

    // НОВОЕ: устройство не доверенное → создаём pending_login и шлём код
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const ua = req.headers['user-agent'] || ''
    const { city, country } = getLocationFromRequest(req)
    const ip = getClientIp(req)
    const deviceLabel = parseUserAgent(ua)

    await pool.query(`
      INSERT INTO pending_logins (user_id, code, code_expires_at, attempts, user_agent, ip, city, country, created_at)
      VALUES ($1, $2, $3, 0, $4, $5, $6, $7, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET code = $2, code_expires_at = $3, attempts = 0,
        user_agent = $4, ip = $5, city = $6, country = $7, created_at = NOW()
    `, [user.id, code, expiresAt, ua, ip, city, country])

    await sendLoginVerificationCode(user.email, code, deviceLabel, city)

    logSecurityEvent(req, {
      event: 'login_verification_required',
      userId: user.id, email,
      metadata: { device: deviceLabel, city, country, ip }
    })

    // Возвращаем сигнал что нужна верификация
    // user_id нужен фронту для отправки на /verify-login
    res.json({
      requires_verification: true,
      user_id: user.id,
      // Маскируем email для подсказки на фронте: nomo@gmail.com → n***@gmail.com
      email_hint: maskEmail(user.email),
      device_label: deviceLabel,
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Хелпер: маскирование email для безопасного показа на фронте
function maskEmail(email) {
  if (!email) return ''
  const [local, domain] = email.split('@')
  if (!domain) return email
  const masked = local[0] + '*'.repeat(Math.max(local.length - 1, 3))
  return `${masked}@${domain}`
}

// ===== Подтверждение логина кодом =====
// На вход: { user_id, code }
// Если код верен → JWT + trusted_device cookie + уведомление о новом входе
router.post('/verify-login', verifyLoginCodeLimiter, async (req, res) => {
  const { user_id, code } = req.body
  if (!user_id || !code) {
    return res.status(400).json({ error: 'Заполни поля' })
  }

  try {
    const pendingResult = await pool.query(
      'SELECT * FROM pending_logins WHERE user_id = $1',
      [user_id]
    )
    if (pendingResult.rows.length === 0) {
      return res.status(400).json({ error: 'Запроси код заново', expired: true })
    }
    const pending = pendingResult.rows[0]

    // Срок
    if (new Date(pending.code_expires_at) < new Date()) {
      await pool.query('DELETE FROM pending_logins WHERE user_id = $1', [user_id])
      logSecurityEvent(req, {
        event: 'login_verification_failed',
        userId: user_id, success: false,
        metadata: { reason: 'expired' }
      })
      return res.status(400).json({ error: 'Код устарел. Войди заново.', expired: true })
    }

    // Попытки
    if (pending.attempts >= 3) {
      await pool.query('DELETE FROM pending_logins WHERE user_id = $1', [user_id])
      logSecurityEvent(req, {
        event: 'login_verification_failed',
        userId: user_id, success: false,
        metadata: { reason: 'too_many_attempts' }
      })
      return res.status(400).json({ error: 'Слишком много попыток. Войди заново.', expired: true })
    }

    // Код
    if (pending.code !== code.toString()) {
      await pool.query(
        'UPDATE pending_logins SET attempts = attempts + 1 WHERE user_id = $1',
        [user_id]
      )
      const remaining = 2 - pending.attempts
      logSecurityEvent(req, {
        event: 'login_verification_failed',
        userId: user_id, success: false,
        metadata: { reason: 'wrong_code', attempts: pending.attempts + 1 }
      })
      return res.status(400).json({
        error: `Неверный код. Осталось попыток: ${remaining}`
      })
    }

    // Получаем юзера
    const userResult = await pool.query(
      'SELECT id, name, email, slug FROM users WHERE id = $1 AND deleted_at IS NULL',
      [user_id]
    )
    if (userResult.rows.length === 0) {
      await pool.query('DELETE FROM pending_logins WHERE user_id = $1', [user_id])
      return res.status(400).json({ error: 'Аккаунт недоступен' })
    }
    const user = userResult.rows[0]

    // Создаём trusted device запись + cookie
    const { deviceToken, deviceLabel, city, country, ip } = await createTrustedDevice(user.id, req)
    setTrustedCookie(res, deviceToken)

    // Удаляем pending
    await pool.query('DELETE FROM pending_logins WHERE user_id = $1', [user_id])

    // Шлём уведомление о новом входе
    await sendNewDeviceLoginNotification(user.email, user.name, deviceLabel, city, country, ip)

    // Выдаём JWT
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })

    logSecurityEvent(req, {
      event: 'login_new_device',
      userId: user.id, email: user.email,
      metadata: { device: deviceLabel, city, country }
    })

    res.json({ token, user })
  } catch (err) {
    console.error('verify-login error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== Перепослать код логина =====
router.post('/resend-login-code', resendLoginCodeLimiter, async (req, res) => {
  const { user_id } = req.body
  if (!user_id) {
    return res.status(400).json({ error: 'user_id required' })
  }

  try {
    const userResult = await pool.query(
      'SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL',
      [user_id]
    )
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Войди заново' })
    }
    const user = userResult.rows[0]

    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const ua = req.headers['user-agent'] || ''
    const { city, country } = getLocationFromRequest(req)
    const ip = getClientIp(req)
    const deviceLabel = parseUserAgent(ua)

    await pool.query(`
      INSERT INTO pending_logins (user_id, code, code_expires_at, attempts, user_agent, ip, city, country, created_at)
      VALUES ($1, $2, $3, 0, $4, $5, $6, $7, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET code = $2, code_expires_at = $3, attempts = 0,
        user_agent = $4, ip = $5, city = $6, country = $7, created_at = NOW()
    `, [user.id, code, expiresAt, ua, ip, city, country])

    await sendLoginVerificationCode(user.email, code, deviceLabel, city)

    logSecurityEvent(req, { event: 'login_code_resent', userId: user.id, email: user.email })

    res.json({ success: true })
  } catch (err) {
    console.error('resend-login-code error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== Забыл пароль =====
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email)
  try {
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [email]
    )

    if (result.rows.length === 0) {
      logSecurityEvent(req, { event: 'password_reset_requested', email, success: false, metadata: { reason: 'user_not_found' } })
      return res.json({ success: true })
    }

    const user = result.rows[0]
    const resetToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [resetToken, expiresAt, user.id]
    )

    const resetLink = `https://app.kogda.app/reset-password/${resetToken}`
    await sendResetPasswordEmail(user.email, user.name, resetLink)

    logSecurityEvent(req, { event: 'password_reset_requested', userId: user.id, email })
    res.json({ success: true })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== Проверка reset-токена =====
router.get('/reset-password/:token/check', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL',
      [req.params.token]
    )
    if (result.rows.length === 0) {
      return res.status(400).json({ valid: false, error: 'Token invalid or expired' })
    }
    res.json({ valid: true, email: result.rows[0].email })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== Установить новый пароль =====
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  const { token, password } = req.body
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' })
  }
  try {
    const result = await pool.query(
      'SELECT id, email FROM users WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL',
      [token]
    )
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Ссылка недействительна или устарела' })
    }
    const user = result.rows[0]

    const hashedPassword = await bcrypt.hash(password, 10)
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hashedPassword, user.id]
    )

    logSecurityEvent(req, { event: 'password_reset_complete', userId: user.id, email: user.email })
    res.json({ success: true })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== Middleware =====
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

// ===== Сменить пароль =====
router.patch('/change-password', changePasswordLimiter, auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Новый пароль должен быть минимум 6 символов' })
  }
  try {
    const result = await pool.query('SELECT password, email FROM users WHERE id = $1', [req.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password)
    if (!valid) {
      logSecurityEvent(req, { event: 'password_change_failed', userId: req.userId, email: result.rows[0].email, success: false })
      return res.status(400).json({ error: 'Текущий пароль неверен' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.userId])

    logSecurityEvent(req, { event: 'password_changed', userId: req.userId, email: result.rows[0].email })
    res.json({ success: true })
  } catch (err) {
    console.error('Change password error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ============================================================================
// ===== СМЕНА EMAIL (НОВОЕ) =====
// ============================================================================

// Шаг 1: запросить код для смены email
router.post('/request-email-change', requestEmailChangeLimiter, auth, async (req, res) => {
  const newEmail = normalizeEmail(req.body.newEmail)
  const { currentPassword } = req.body

  if (!newEmail || !currentPassword) {
    return res.status(400).json({ error: 'Заполни все поля' })
  }
  if (!newEmail.includes('@') || !newEmail.includes('.')) {
    return res.status(400).json({ error: 'Введи корректный email' })
  }

  try {
    const userResult = await pool.query(
      'SELECT id, email, password, name FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.userId]
    )
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    const user = userResult.rows[0]

    // Новый email не должен совпадать со старым
    if (newEmail === user.email.toLowerCase()) {
      return res.status(400).json({ error: 'Это твой текущий email' })
    }

    // Проверяем пароль
    const validPassword = await bcrypt.compare(currentPassword, user.password)
    if (!validPassword) {
      logSecurityEvent(req, {
        event: 'email_change_failed',
        userId: user.id,
        email: user.email,
        success: false,
        metadata: { reason: 'wrong_password', new_email: newEmail }
      })
      return res.status(400).json({ error: 'Неверный пароль' })
    }

    // Новый email не должен быть занят
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [newEmail]
    )
    if (existing.rows.length > 0) {
      logSecurityEvent(req, {
        event: 'email_change_failed',
        userId: user.id,
        email: user.email,
        success: false,
        metadata: { reason: 'email_taken', new_email: newEmail }
      })
      return res.status(400).json({ error: 'Этот email уже занят' })
    }

    // Генерируем код и кладём в БД (UPSERT — новый запрос затирает старый)
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await pool.query(`
      INSERT INTO pending_email_changes (user_id, new_email, code, code_expires_at, attempts, created_at)
      VALUES ($1, $2, $3, $4, 0, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET new_email = $2, code = $3, code_expires_at = $4, attempts = 0, created_at = NOW()
    `, [user.id, newEmail, code, expiresAt])

    // Шлём код на НОВЫЙ email
    await sendEmailChangeCode(newEmail, code)

    logSecurityEvent(req, {
      event: 'email_change_requested',
      userId: user.id,
      email: user.email,
      metadata: { new_email: newEmail }
    })

    res.json({ success: true, newEmail })
  } catch (err) {
    console.error('request-email-change error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Шаг 2: подтвердить код и сменить email
router.post('/verify-email-change', verifyEmailChangeLimiter, auth, async (req, res) => {
  const { code } = req.body

  if (!code) {
    return res.status(400).json({ error: 'Введи код' })
  }

  try {
    const pendingResult = await pool.query(
      'SELECT * FROM pending_email_changes WHERE user_id = $1',
      [req.userId]
    )
    if (pendingResult.rows.length === 0) {
      return res.status(400).json({ error: 'Запрос не найден. Начни сначала.', expired: true })
    }
    const pending = pendingResult.rows[0]

    // Проверка срока
    if (new Date(pending.code_expires_at) < new Date()) {
      await pool.query('DELETE FROM pending_email_changes WHERE user_id = $1', [req.userId])
      logSecurityEvent(req, {
        event: 'email_change_failed',
        userId: req.userId,
        success: false,
        metadata: { reason: 'expired' }
      })
      return res.status(400).json({ error: 'Код устарел. Запроси новый.', expired: true })
    }

    // Проверка количества попыток
    if (pending.attempts >= 3) {
      await pool.query('DELETE FROM pending_email_changes WHERE user_id = $1', [req.userId])
      logSecurityEvent(req, {
        event: 'email_change_failed',
        userId: req.userId,
        success: false,
        metadata: { reason: 'too_many_attempts' }
      })
      return res.status(400).json({ error: 'Слишком много попыток. Запроси код заново.', expired: true })
    }

    // Проверка кода
    if (pending.code !== code.toString()) {
      await pool.query(
        'UPDATE pending_email_changes SET attempts = attempts + 1 WHERE user_id = $1',
        [req.userId]
      )
      const remaining = 2 - pending.attempts
      logSecurityEvent(req, {
        event: 'email_change_failed',
        userId: req.userId,
        success: false,
        metadata: { reason: 'wrong_code', attempts: pending.attempts + 1 }
      })
      return res.status(400).json({
        error: `Неверный код. Осталось попыток: ${remaining}`
      })
    }

    // Перепроверяем что новый email всё ещё свободен
    // (мог занять кто-то пока юзер вводил код)
    const occupied = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL AND id != $2',
      [pending.new_email, req.userId]
    )
    if (occupied.rows.length > 0) {
      await pool.query('DELETE FROM pending_email_changes WHERE user_id = $1', [req.userId])
      return res.status(400).json({ error: 'Этот email уже занят. Запроси другой.' })
    }

    // Получаем старый email и имя для уведомления
    const userResult = await pool.query(
      'SELECT email, name FROM users WHERE id = $1',
      [req.userId]
    )
    const oldEmail = userResult.rows[0].email
    const userName = userResult.rows[0].name

    // Меняем email в БД
    await pool.query(
      'UPDATE users SET email = $1 WHERE id = $2',
      [pending.new_email, req.userId]
    )

    // Удаляем запрос
    await pool.query('DELETE FROM pending_email_changes WHERE user_id = $1', [req.userId])

    // Маскируем новый email: nomo@email.com → n***@email.com
    const [localPart, domain] = pending.new_email.split('@')
    const maskedEmail = `${localPart[0]}${'*'.repeat(Math.max(localPart.length - 1, 3))}@${domain}`

    // Шлём уведомление на СТАРЫЙ email
    await sendEmailChangedNotification(oldEmail, userName, maskedEmail)

    logSecurityEvent(req, {
      event: 'email_changed',
      userId: req.userId,
      email: pending.new_email,
      metadata: { old_email: oldEmail }
    })

    res.json({ success: true, new_email: pending.new_email })
  } catch (err) {
    console.error('verify-email-change error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Отмена запроса (если юзер закрыл модалку)
router.delete('/cancel-email-change', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM pending_email_changes WHERE user_id = $1', [req.userId])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// ============================================================================

// ===== Удалить аккаунт =====
// Логика:
// 1. Проверяем пароль
// 2. Считаем будущие confirmed-записи
// 3. Если есть и не пришло confirm_with_bookings=true → 409 с bookings_count
// 4. Если confirm_with_bookings=true ИЛИ записей нет:
//    - Отменяем все будущие confirmed (status='cancelled')
//    - Шлём email каждому клиенту с уведомлением об отмене
//    - Ставим deleted_at и scheduled_delete_at
router.delete('/delete-account', deleteAccountLimiter, auth, async (req, res) => {
  const { password, confirm_with_bookings } = req.body
  if (!password) {
    return res.status(400).json({ error: 'Введите пароль для подтверждения' })
  }
  try {
    const result = await pool.query(
      'SELECT id, password, email, name FROM users WHERE id = $1',
      [req.userId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = result.rows[0]

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(400).json({ error: 'Неверный пароль' })

    // Считаем будущие confirmed-записи юзера
    const futureBookings = await pool.query(
      `SELECT b.id, b.client_email, b.client_name, b.start_time, mt.title AS meeting_title
       FROM bookings b
       JOIN meeting_types mt ON b.meeting_type_id = mt.id
       WHERE mt.user_id = $1
         AND b.status = 'confirmed'
         AND b.start_time > NOW()
       ORDER BY b.start_time`,
      [user.id]
    )

    const bookingsCount = futureBookings.rows.length

    // Если есть будущие записи и юзер ещё не подтвердил — возвращаем 409
    if (bookingsCount > 0 && !confirm_with_bookings) {
      return res.status(409).json({
        error: 'has_future_bookings',
        bookings_count: bookingsCount
      })
    }

    // Если есть записи — отменяем и шлём email каждому клиенту
    if (bookingsCount > 0) {
      const bookingIds = futureBookings.rows.map(b => b.id)
      await pool.query(
        `UPDATE bookings SET status = 'cancelled' WHERE id = ANY($1)`,
        [bookingIds]
      )

      for (const b of futureBookings.rows) {
        const date = new Date(b.start_time)
        const dateStr = date.toISOString().split('T')[0]
        const timeStr = date.toTimeString().slice(0, 5)
        sendBookingCancelledByCoachEmail(
          b.client_email,
          b.client_name,
          b.meeting_title,
          dateStr,
          timeStr,
          user.name
        )
      }

      logSecurityEvent(req, {
        event: 'account_deleted_with_bookings',
        userId: req.userId,
        email: user.email,
        metadata: { bookings_cancelled: bookingsCount }
      })
    }

    // Помечаем аккаунт удалённым
    const scheduledDelete = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await pool.query(
      'UPDATE users SET deleted_at = NOW(), scheduled_delete_at = $1 WHERE id = $2',
      [scheduledDelete, req.userId]
    )

    // Email коучу с подтверждением и инструкцией по восстановлению
    sendAccountDeletionEmail(user.email, user.name, scheduledDelete, bookingsCount)

    logSecurityEvent(req, { event: 'account_deleted', userId: req.userId, email: user.email })
    res.json({
      success: true,
      scheduledDeleteAt: scheduledDelete,
      cancelledBookings: bookingsCount
    })
  } catch (err) {
    console.error('Delete account error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== Просмотр security-логов (только для админа) =====
router.get('/security-logs', auth, async (req, res) => {
  const adminId = parseInt(process.env.ADMIN_USER_ID)
  if (!adminId || req.userId !== adminId) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const limit = Math.min(parseInt(req.query.limit) || 100, 500)
  const offset = parseInt(req.query.offset) || 0
  const eventType = req.query.event || null
  const userIdFilter = req.query.user_id ? parseInt(req.query.user_id) : null

  try {
    const conditions = []
    const params = []

    if (eventType) {
      params.push(eventType)
      conditions.push(`event_type = $${params.length}`)
    }
    if (userIdFilter) {
      params.push(userIdFilter)
      conditions.push(`user_id = $${params.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(limit, offset)

    const result = await pool.query(
      `SELECT * FROM security_logs ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json(result.rows)
  } catch (err) {
    console.error('Security logs error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ============================================================================
// ===== УПРАВЛЕНИЕ ДОВЕРЕННЫМИ УСТРОЙСТВАМИ =====
// ============================================================================

// Список устройств юзера
router.get('/devices', auth, async (req, res) => {
  try {
    // Текущий cookie токен — чтобы пометить is_current
    const cookieToken = parseCookie(req.headers.cookie, 'trusted_device_token')

    const result = await pool.query(
      `SELECT id, device_label, last_city, last_country, last_used_at, created_at, expires_at,
              (device_token = $2) AS is_current
       FROM trusted_devices
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY (device_token = $2) DESC, last_used_at DESC`,
      [req.userId, cookieToken || '']
    )

    // Обновляем last_used_at текущего устройства
    if (cookieToken) {
      await pool.query(
        'UPDATE trusted_devices SET last_used_at = NOW() WHERE user_id = $1 AND device_token = $2',
        [req.userId, cookieToken]
      )
    }

    res.json({ devices: result.rows })
  } catch (err) {
    console.error('Get devices error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Отозвать одно устройство
router.delete('/devices/:id', auth, async (req, res) => {
  const deviceId = parseInt(req.params.id)
  if (!deviceId) {
    return res.status(400).json({ error: 'Invalid device id' })
  }

  try {
    // Проверяем что устройство принадлежит этому юзеру
    const result = await pool.query(
      'SELECT id, device_token, device_label FROM trusted_devices WHERE id = $1 AND user_id = $2',
      [deviceId, req.userId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Устройство не найдено' })
    }
    const device = result.rows[0]

    // Удаляем
    await pool.query('DELETE FROM trusted_devices WHERE id = $1', [deviceId])

    // Если удаляли ТЕКУЩЕЕ устройство — стираем cookie
    const cookieToken = parseCookie(req.headers.cookie, 'trusted_device_token')
    const isCurrent = device.device_token === cookieToken
    if (isCurrent) {
      // Set-Cookie с Max-Age=0 = стирание cookie
      const isProd = process.env.NODE_ENV === 'production'
      const parts = [
        `trusted_device_token=`,
        `Max-Age=0`,
        `Path=/`,
        `HttpOnly`,
        `SameSite=Lax`,
      ]
      if (isProd) parts.push('Secure')
      res.setHeader('Set-Cookie', parts.join('; '))
    }

    logSecurityEvent(req, {
      event: 'device_revoked',
      userId: req.userId,
      metadata: { device_label: device.device_label, was_current: isCurrent }
    })

    res.json({ success: true, was_current: isCurrent })
  } catch (err) {
    console.error('Delete device error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Выйти со всех устройств кроме текущего
router.delete('/devices', auth, async (req, res) => {
  try {
    const cookieToken = parseCookie(req.headers.cookie, 'trusted_device_token')

    const result = await pool.query(
      'DELETE FROM trusted_devices WHERE user_id = $1 AND device_token != $2 RETURNING id',
      [req.userId, cookieToken || '']
    )

    logSecurityEvent(req, {
      event: 'all_devices_revoked',
      userId: req.userId,
      metadata: { revoked_count: result.rowCount }
    })

    res.json({ success: true, revoked_count: result.rowCount })
  } catch (err) {
    console.error('Delete all devices error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ============================================================================

module.exports = router