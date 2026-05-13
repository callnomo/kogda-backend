const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')
const { makeSlug, makeUniqueSlug } = require('./slugify')

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

// Список полей которые можно обновлять через PATCH /:id
// Ключ — имя поля в БД; значение — функция нормализации значения перед записью.
// Если поле отсутствует в req.body — оно не будет обновлено (partial update).
const PATCHABLE_FIELDS = {
  title: (v) => v,
  description: (v) => v,
  duration: (v) => v,
  price: (v) => v,
  hide_price: (v) => !!v,
  buffer_before: (v) => v || 0,
  buffer_after: (v) => v || 0,
  min_notice: (v) => v || 0,
  max_days_ahead: (v) => v || 60,
  max_per_day: (v) => v || 0,
  require_confirm: (v) => !!v,
  cancellation_policy: (v) => v || null,
  price_mode: (v) => v || 'amount',
  location_type: (v) => v || 'video',
  step_minutes: (v) => v || 30,
  enabled_payments: (v) => v ? JSON.stringify(v) : null,
  enabled_banks: (v) => v ? JSON.stringify(v) : null,
}

// ============ ОБЫЧНЫЕ ENDPOINT'Ы ДЛЯ УСЛУГ ============

router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM meeting_types WHERE user_id = $1 ORDER BY sort_order ASC, created_at DESC',
      [req.userId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Изменить порядок услуг. Принимает { order: [id1, id2, id3, ...] } — id в новом порядке.
router.patch('/reorder', auth, async (req, res) => {
  const { order } = req.body
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (let i = 0; i < order.length; i++) {
      const id = order[i]
      await client.query(
        `UPDATE meeting_types SET sort_order = $1 WHERE id = $2 AND user_id = $3`,
        [i + 1, id, req.userId]
      )
    }

    await client.query('COMMIT')
    res.json({ success: true })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[meetings reorder]', err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

router.post('/', auth, async (req, res) => {
  const {
    title, description, duration, price, hide_price, currency,
    buffer_before, buffer_after, min_notice, max_days_ahead, max_per_day,
    require_confirm, cancellation_policy,
    price_mode, location_type, step_minutes, enabled_payments, enabled_banks
  } = req.body
  try {
    const baseSlug = makeSlug(title)
    const slug = await makeUniqueSlug(pool, req.userId, baseSlug)

    const maxOrder = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS max FROM meeting_types WHERE user_id = $1`,
      [req.userId]
    )
    const newSortOrder = parseInt(maxOrder.rows[0].max, 10) + 1

    const result = await pool.query(
      `INSERT INTO meeting_types 
       (user_id, title, slug, description, duration, price, hide_price, currency,
        buffer_before, buffer_after, min_notice, max_days_ahead, max_per_day,
        require_confirm, cancellation_policy, sort_order,
        price_mode, location_type, step_minutes, enabled_payments, enabled_banks) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
               $17, $18, $19, $20, $21) RETURNING *`,
      [req.userId, title, slug, description, duration, price || 0, hide_price || false, currency || 'RUB',
       buffer_before || 0, buffer_after || 0, min_notice || 0, max_days_ahead || 60, max_per_day || 0,
       require_confirm || false, cancellation_policy || null, newSortOrder,
       price_mode || 'amount', location_type || 'video', step_minutes || 30,
       enabled_payments ? JSON.stringify(enabled_payments) : null,
       enabled_banks ? JSON.stringify(enabled_banks) : null]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('[meetings POST]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /:id — partial update. Обновляет только поля которые пришли в req.body.
// Никаких обязательных полей. Если поле в PATCHABLE_FIELDS и присутствует в body — обновится.
router.patch('/:id', auth, async (req, res) => {
  try {
    const setClauses = []
    const values = []
    let paramIdx = 1

    for (const field of Object.keys(PATCHABLE_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        setClauses.push(`${field} = $${paramIdx}`)
        values.push(PATCHABLE_FIELDS[field](req.body[field]))
        paramIdx++
      }
    }

    if (setClauses.length === 0) {
      // Ничего не обновляем — просто возвращаем текущее состояние услуги
      const result = await pool.query(
        `SELECT * FROM meeting_types WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.userId]
      )
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' })
      return res.json(result.rows[0])
    }

    values.push(req.params.id)
    values.push(req.userId)

    const result = await pool.query(
      `UPDATE meeting_types SET ${setClauses.join(', ')} 
       WHERE id = $${paramIdx} AND user_id = $${paramIdx + 1} RETURNING *`,
      values
    )

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' })
    res.json(result.rows[0])
  } catch (err) {
    console.error('[meetings PATCH]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.patch('/:id/visibility', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE meeting_types SET is_active = NOT is_active 
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.userId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' })
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

// ============ ОДНОРАЗОВЫЕ ССЫЛКИ ============

router.post('/:id/single-use', auth, async (req, res) => {
  try {
    const meeting = await pool.query(
      'SELECT id FROM meeting_types WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    )
    if (meeting.rows.length === 0) return res.status(404).json({ error: 'Meeting not found' })

    const token = crypto.randomBytes(16).toString('hex')

    const result = await pool.query(
      `INSERT INTO single_use_links (meeting_type_id, token) VALUES ($1, $2) RETURNING *`,
      [req.params.id, token]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('[single-use POST]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/:id/single-use', auth, async (req, res) => {
  try {
    const meeting = await pool.query(
      'SELECT id FROM meeting_types WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    )
    if (meeting.rows.length === 0) return res.status(404).json({ error: 'Meeting not found' })

    const result = await pool.query(
      'SELECT * FROM single_use_links WHERE meeting_type_id = $1 AND used = false ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json(result.rows)
  } catch (err) {
    console.error('[single-use GET]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/single-use/:token', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM single_use_links 
       WHERE token = $1 
       AND meeting_type_id IN (SELECT id FROM meeting_types WHERE user_id = $2)
       RETURNING id`,
      [req.params.token, req.userId]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Token not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('[single-use DELETE]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ============ ПУБЛИЧНЫЕ ENDPOINT'Ы ============

router.get('/public/:slug', async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, name, bio, avatar, slug FROM users WHERE slug = $1',
      [req.params.slug]
    )
    if (user.rows.length === 0) return res.status(404).json({ error: 'Not found' })
    const meetings = await pool.query(
      'SELECT * FROM meeting_types WHERE user_id = $1 AND is_active = true ORDER BY sort_order ASC, created_at DESC',
      [user.rows[0].id]
    )
    res.json({ user: user.rows[0], meetings: meetings.rows })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/public/:userSlug/:serviceSlug', async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, name, bio, avatar, slug FROM users WHERE slug = $1',
      [req.params.userSlug]
    )
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const meeting = await pool.query(
      'SELECT * FROM meeting_types WHERE user_id = $1 AND slug = $2',
      [user.rows[0].id, req.params.serviceSlug]
    )
    if (meeting.rows.length === 0) return res.status(404).json({ error: 'Service not found' })

    res.json({ user: user.rows[0], meeting: meeting.rows[0] })
  } catch (err) {
    console.error('[meetings public direct]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/once/:token', async (req, res) => {
  try {
    const link = await pool.query(
      'SELECT * FROM single_use_links WHERE token = $1',
      [req.params.token]
    )
    if (link.rows.length === 0) return res.status(404).json({ error: 'Link not found' })
    if (link.rows[0].used) return res.status(410).json({ error: 'Link already used' })

    const meeting = await pool.query(
      'SELECT * FROM meeting_types WHERE id = $1',
      [link.rows[0].meeting_type_id]
    )
    if (meeting.rows.length === 0) return res.status(404).json({ error: 'Meeting not found' })

    const user = await pool.query(
      'SELECT id, name, bio, avatar, slug FROM users WHERE id = $1',
      [meeting.rows[0].user_id]
    )
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    res.json({ user: user.rows[0], meeting: meeting.rows[0], token: req.params.token })
  } catch (err) {
    console.error('[meetings once GET]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/once/:token/use', async (req, res) => {
  try {
    const { booking_id } = req.body
    const result = await pool.query(
      `UPDATE single_use_links 
       SET used = true, used_at = NOW(), booking_id = $1 
       WHERE token = $2 AND used = false 
       RETURNING *`,
      [booking_id || null, req.params.token]
    )
    if (result.rows.length === 0) return res.status(410).json({ error: 'Link already used or not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('[meetings once use]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router