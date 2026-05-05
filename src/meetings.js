const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')

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

router.post('/', auth, async (req, res) => {
  const { title, description, duration, price, currency, buffer_before, buffer_after, min_notice, max_days_ahead, max_per_day, require_confirm, cancellation_policy } = req.body
  try {
    const result = await pool.query(
      `INSERT INTO meeting_types 
       (user_id, title, description, duration, price, currency, buffer_before, buffer_after, min_notice, max_days_ahead, max_per_day, require_confirm, cancellation_policy) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [req.userId, title, description, duration, price || 0, currency || 'RUB',
       buffer_before || 0, buffer_after || 0, min_notice || 0, max_days_ahead || 60, max_per_day || 0, require_confirm || false, cancellation_policy || null]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.patch('/:id', auth, async (req, res) => {
  const { title, description, duration, price, buffer_before, buffer_after, min_notice, max_days_ahead, max_per_day, require_confirm, cancellation_policy } = req.body
  try {
    const result = await pool.query(
      `UPDATE meeting_types SET 
       title=$1, description=$2, duration=$3, price=$4,
       buffer_before=$5, buffer_after=$6, min_notice=$7, max_days_ahead=$8, max_per_day=$9,
       require_confirm=$10, cancellation_policy=$11
       WHERE id=$12 AND user_id=$13 RETURNING *`,
      [title, description, duration, price, buffer_before || 0, buffer_after || 0,
       min_notice || 0, max_days_ahead || 60, max_per_day || 0, require_confirm || false, cancellation_policy || null, req.params.id, req.userId]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

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

router.get('/public/:slug', async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, name, bio, avatar, slug FROM users WHERE slug = $1',
      [req.params.slug]
    )
    if (user.rows.length === 0) return res.status(404).json({ error: 'Not found' })
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