const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')

// Middleware для проверки токена
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

// Получить все типы встреч пользователя
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM meeting_types WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Создать тип встречи
router.post('/', auth, async (req, res) => {
  const { title, description, duration, price, currency } = req.body
  try {
    const result = await pool.query(
      'INSERT INTO meeting_types (user_id, title, description, duration, price, currency) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.userId, title, description, duration, price || 0, currency || 'RUB']
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Удалить тип встречи
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM meeting_types WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Публичная страница пользователя
router.get('/public/:slug', async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, name, bio, avatar, slug FROM users WHERE slug = $1',
      [req.params.slug]
    )
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' })
    }
    const meetings = await pool.query(
      'SELECT * FROM meeting_types WHERE user_id = $1 AND is_active = true',
      [user.rows[0].id]
    )
    res.json({ user: user.rows[0], meetings: meetings.rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router