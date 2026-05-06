const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const pool = require('./db')
const { sendResetPasswordEmail } = require('./email')

// ===== Регистрация =====
router.post('/register', async (req, res) => {
  const { name, email, password, slug } = req.body
  try {
    const exists = await pool.query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [email])
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: 'Email already taken' })
    }
    const slugExists = await pool.query('SELECT id FROM users WHERE slug = $1 AND deleted_at IS NULL', [slug])
    if (slugExists.rows.length > 0) {
      return res.status(400).json({ error: 'Slug already taken' })
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const result = await pool.query(
      'INSERT INTO users (name, email, password, slug) VALUES ($1, $2, $3, $4) RETURNING id, name, email, slug',
      [name, email, hashedPassword, slug]
    )
    const user = result.rows[0]
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' })
    res.json({ token, user })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== Логин =====
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' })
    }
    const user = result.rows[0]

    // Если аккаунт помечен на удаление — восстанавливаем при логине
    if (user.deleted_at) {
      // Проверяем пароль
      const validPassword = await bcrypt.compare(password, user.password)
      if (!validPassword) {
        return res.status(400).json({ error: 'Invalid email or password' })
      }
      // Восстанавливаем
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

// ===== Забыл пароль: запрос ссылки =====
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  try {
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email]
    )

    // ВАЖНО: всегда возвращаем успех, даже если email не найден.
    // Это защита от перебора email-адресов.
    if (result.rows.length === 0) {
      return res.json({ success: true })
    }

    const user = result.rows[0]

    // Генерируем токен и сохраняем
    const resetToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // +1 час

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [resetToken, expiresAt, user.id]
    )

    // Отправляем письмо
    const resetLink = `https://app.kogda.app/reset-password/${resetToken}`
    await sendResetPasswordEmail(user.email, user.name, resetLink)

    res.json({ success: true })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ===== Проверка валидности токена сброса =====
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

// ===== Установить новый пароль по токену =====
router.post('/reset-password', async (req, res) => {
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

// ===== Middleware для защищённых endpoints =====
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

// ===== Сменить пароль (для залогиненных) =====
router.patch('/change-password', auth, async (req, res) => {
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

// ===== Удалить аккаунт (soft delete на 30 дней) =====
router.delete('/delete-account', auth, async (req, res) => {
  const { password } = req.body
  if (!password) {
    return res.status(400).json({ error: 'Введите пароль для подтверждения' })
  }
  try {
    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const valid = await bcrypt.compare(password, result.rows[0].password)
    if (!valid) return res.status(400).json({ error: 'Неверный пароль' })

    // Soft delete: помечаем удалённым и ставим дату полного удаления через 30 дней
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