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

const normalizeEmail = (email) => (email || '').trim().toLowerCase()

// 6-значный код
const generateCode = () => {
  // 100000-999999, гарантированно 6 цифр
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
// Всегда отвечает success — если email занят, шлём предупреждение, не код.
router.post('/request-code', requestCodeLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email)
  if (!email) {
    return res.status(400).json({ error: 'Введи email' })
  }

  try {
    // Проверяем — есть ли уже зарегистрированный (не удалённый) юзер с таким email
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [email]
    )

    if (existing.rows.length > 0) {
      // Email уже занят. Шлём предупреждающее письмо.
      // ВАЖНО: фронту всегда отвечаем success — атакующий не должен узнать что email занят.
      await sendEmailTakenWarning(email)
      return res.json({ success: true })
    }

    // Email свободен. Генерим код, сохраняем в pending_registrations, шлём.
    const code = generateCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 минут

    // upsert — если уже есть pending для этого email, перезаписываем
    await pool.query(`
      INSERT INTO pending_registrations (email, code, code_expires_at, attempts, created_at)
      VALUES ($1, $2, $3, 0, NOW())
      ON CONFLICT (email)
      DO UPDATE SET code = $2, code_expires_at = $3, attempts = 0, created_at = NOW()
    `, [email, code, expiresAt])

    await sendVerificationCode(email, code)
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
      return res.status(400).json({ error: 'Запроси код заново' })
    }

    const pending = result.rows[0]

    // Проверка истечения
    if (new Date(pending.code_expires_at) < new Date()) {
      await pool.query('DELETE FROM pending_registrations WHERE email = $1', [email])
      return res.status(400).json({ error: 'Код устарел. Запроси новый.', expired: true })
    }

    // Проверка попыток
    if (pending.attempts >= 3) {
      await pool.query('DELETE FROM pending_registrations WHERE email = $1', [email])
      return res.status(400).json({ error: 'Слишком много попыток. Запроси код заново.', expired: true })
    }

    // Проверка кода
    if (pending.code !== code.toString()) {
      await pool.query(
        'UPDATE pending_registrations SET attempts = attempts + 1 WHERE email = $1',
        [email]
      )
      const remaining = 2 - pending.attempts
      return res.status(400).json({
        error: `Неверный код. Осталось попыток: ${remaining}`
      })
    }

    // Код верный — выдаём временный JWT для шага 3 (живёт 15 минут)
    const tempToken = jwt.sign(
      { email, purpose: 'complete-registration' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    )

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

    // Двойная проверка — за 15 минут email мог занять кто-то другой (теоретически)
    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [email]
    )
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Этот email уже зарегистрирован' })
    }

    // Создаём юзера
    const slug = await generateUniqueSlug()
    const hashedPassword = await bcrypt.hash(password, 10)

    const result = await pool.query(
      'INSERT INTO users (name, email, password, slug) VALUES ($1, $2, $3, $4) RETURNING id, name, email, slug',
      [name, email, hashedPassword, slug]
    )

    // Удаляем pending запись
    await pool.query('DELETE FROM pending_registrations WHERE email = $1', [email])

    const user = result.rows[0]
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })

    res.json({ token, user })
  } catch (err) {
    console.error('complete-registration error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== СТАРЫЙ /register — оставляем для обратной совместимости =====
// Если фронт случайно дёрнет старый endpoint — корректно ответим.
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
      return res.status(400).json({ error: 'Invalid email or password' })
    }
    const user = result.rows[0]

    if (user.deleted_at) {
      const validPassword = await bcrypt.compare(password, user.password)
      if (!validPassword) {
        return res.status(400).json({ error: 'Invalid email or password' })
      }
      await pool.query(
        'UPDATE users SET deleted_at = NULL, scheduled_delete_at = NULL WHERE id = $1',
        [user.id]
      )
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })
      return res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, slug: user.slug },
        restored: true
      })
    }

    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid email or password' })
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })
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
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL',
      [token]
    )
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Ссылка недействительна или устарела' })
    }
    const userId = result.rows[0].id

    const hashedPassword = await bcrypt.hash(password, 10)
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hashedPassword, userId]
    )

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
    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password)
    if (!valid) return res.status(400).json({ error: 'Текущий пароль неверен' })

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.userId])

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
    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const valid = await bcrypt.compare(password, result.rows[0].password)
    if (!valid) return res.status(400).json({ error: 'Неверный пароль' })

    const scheduledDelete = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await pool.query(
      'UPDATE users SET deleted_at = NOW(), scheduled_delete_at = $1 WHERE id = $2',
      [scheduledDelete, req.userId]
    )

    res.json({ success: true, scheduledDeleteAt: scheduledDelete })
  } catch (err) {
    console.error('Delete account error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router