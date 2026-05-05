const express = require('express')
const router = express.Router()
const pool = require('./db')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')

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

// Получить настройки
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, slug, bio, avatar, telegram_chat_id,
       notify_telegram, notify_email, notify_whatsapp, notify_max,
       whatsapp_phone, max_phone,
       payment_sbp, payment_tinkoff, payment_sber, payment_kaspi,
       payment_paypal, payment_wise, payment_usdt, payment_bank, payment_other
       FROM users WHERE id = $1`,
      [req.userId]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Генерировать токен для Telegram
router.post('/telegram/token', auth, async (req, res) => {
  try {
    const token = crypto.randomBytes(16).toString('hex')
    await pool.query('UPDATE users SET telegram_token = $1 WHERE id = $2', [token, req.userId])
    const botUsername = 'kogdaapp_bot'
    const telegramLink = `https://t.me/${botUsername}?start=${token}`
    res.json({ token, link: telegramLink })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Обновить профиль
router.patch('/profile', auth, async (req, res) => {
  const { name, bio, slug } = req.body
  try {
    if (slug) {
      const exists = await pool.query(
        'SELECT id FROM users WHERE slug = $1 AND id != $2',
        [slug, req.userId]
      )
      if (exists.rows.length > 0) return res.status(400).json({ error: 'Этот никнейм уже занят' })
    }
    const result = await pool.query(
      'UPDATE users SET name = COALESCE($1, name), bio = COALESCE($2, bio), slug = COALESCE($3, slug) WHERE id = $4 RETURNING id, name, email, slug, bio',
      [name, bio, slug, req.userId]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Обновить настройки уведомлений
router.patch('/notifications', auth, async (req, res) => {
  const { notify_telegram, notify_email, notify_whatsapp, notify_max, whatsapp_phone, max_phone } = req.body
  try {
    await pool.query(
      `UPDATE users SET 
       notify_telegram = $1, notify_email = $2, 
       notify_whatsapp = $3, notify_max = $4,
       whatsapp_phone = $5, max_phone = $6
       WHERE id = $7`,
      [notify_telegram, notify_email, notify_whatsapp, notify_max, whatsapp_phone, max_phone, req.userId]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Обновить способы оплаты
router.patch('/payments', auth, async (req, res) => {
  const { payment_sbp, payment_tinkoff, payment_sber, payment_kaspi, payment_paypal, payment_wise, payment_usdt, payment_bank, payment_other } = req.body
  try {
    await pool.query(
      `UPDATE users SET 
       payment_sbp=$1, payment_tinkoff=$2, payment_sber=$3, payment_kaspi=$4,
       payment_paypal=$5, payment_wise=$6, payment_usdt=$7, payment_bank=$8, payment_other=$9
       WHERE id=$10`,
      [payment_sbp, payment_tinkoff, payment_sber, payment_kaspi, payment_paypal, payment_wise, payment_usdt, payment_bank, payment_other, req.userId]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router