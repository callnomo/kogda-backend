const pool = require('./db')

/**
 * Извлекает IP клиента из запроса (учитывая прокси Railway)
 */
function getIp(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || null
}

/**
 * Извлекает User-Agent
 */
function getUserAgent(req) {
  return req.headers['user-agent'] || null
}

/**
 * Логирует security-событие в БД.
 * Никогда не падает — если запись лога упала, просто пишем console.error.
 *
 * @param {Object} req - Express request
 * @param {Object} options
 * @param {string} options.event - Тип события (login_success, login_failed и т.д.)
 * @param {number|null} options.userId - ID юзера если известен
 * @param {string|null} options.email - Email если есть
 * @param {boolean} options.success - true/false
 * @param {Object} options.metadata - Доп. данные в JSON
 */
async function logSecurityEvent(req, { event, userId = null, email = null, success = true, metadata = null }) {
  try {
    await pool.query(
      `INSERT INTO security_logs 
       (event_type, user_id, email, ip, user_agent, success, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event, userId, email, getIp(req), getUserAgent(req), success, metadata ? JSON.stringify(metadata) : null]
    )
  } catch (err) {
    console.error('[securityLog] Ошибка записи:', err.message)
    // Не пробрасываем ошибку дальше - логирование не должно ломать основной флоу
  }
}

module.exports = { logSecurityEvent }