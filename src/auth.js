const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const pool = require('./db')
const {
  sendResetPasswordEmail,
  sendVerificationCode,
  sendEmailTakenWarning
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
} = require('./rateLimiters')
const { logSecurityEvent } = require('./securityLog')

const normalizeEmail = (email) => (email || '').trim().toLowerCase()

// 6-значный код
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Уникальный slug user-XXXXXXX
async function generateUniqueSlug() {
  for (let i = 0; i < 5; i++) {
    const random = crypto.randomBytes(4).toString('hex').slice(0, 7)
    const slug = `user-${random}`
    const exists = await pool.query('SELECT id FROM users WHERE slug = $1', [slug])
    if (exists.rows.length === 0) return slug
  }
  return `user-${crypto.randomBytes(4).toString('hex').slice(0, 7)}-${Date.now().toString(36)}`
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
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })
      logSecurityEvent(req, { event: 'account_restored', userId: user.id, email })
      return res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, slug: user.slug },
        restored: true
      })
    }

    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) {
      logSecurityEvent(req, { event: 'login_failed', userId: user.id, email, success: false, metadata: { reason: 'wrong_password' } })
      return res.status(400).json({ error: 'Invalid email or password' })
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })
    logSecurityEvent(req, { event: 'login_success', userId: user.id, email })
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, slug: user.slug } })
  } catch (err) {
    console.error(err)
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

// ===== Удалить аккаунт =====
router.delete('/delete-account', deleteAccountLimiter, auth, async (req, res) => {
  const { password } = req.body
  if (!password) {
    return res.status(400).json({ error: 'Введите пароль для подтверждения' })
  }
  try {
    const result = await pool.query('SELECT password, email FROM users WHERE id = $1', [req.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const valid = await bcrypt.compare(password, result.rows[0].password)
    if (!valid) return res.status(400).json({ error: 'Неверный пароль' })

    const scheduledDelete = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await pool.query(
      'UPDATE users SET deleted_at = NOW(), scheduled_delete_at = $1 WHERE id = $2',
      [scheduledDelete, req.userId]
    )

    logSecurityEvent(req, { event: 'account_deleted', userId: req.userId, email: result.rows[0].email })
    res.json({ success: true, scheduledDeleteAt: scheduledDelete })
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
      `SELECT id, event_type, user_id, email, ip, user_agent, success, metadata, created_at
       FROM security_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM security_logs ${where}`,
      params.slice(0, -2)
    )

    res.json({
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
      logs: result.rows,
    })
  } catch (err) {
    console.error('security-logs error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})
module.exports = router