const rateLimit = require('express-rate-limit')

// Логин — 5 попыток за 15 минут с одного IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
})

// Запрос кода для регистрации — 3 за час (защита от спама email и Resend)
const requestCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Слишком много запросов кода. Попробуйте через час.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Проверка кода — 10 попыток за 15 минут с IP (внутри ещё 3 попытки на email)
const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток ввода кода. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Завершение регистрации — 5 за час
const completeRegistrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Слишком много попыток. Попробуйте через час.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Забыл пароль — 3 за час (защита от спама писем)
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Слишком много запросов. Попробуйте через час.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Установка нового пароля по токену — 5 за 15 минут
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Смена пароля авторизованным юзером — 5 за 15 минут
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Слишком много попыток смены пароля. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Удаление аккаунта — 3 за час
const deleteAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Слишком много попыток. Попробуйте через час.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Запрос смены email — 3 за час
const requestEmailChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Слишком много запросов смены email. Попробуй через час.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Проверка кода смены email — 10 за 15 минут с IP
const verifyEmailChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток. Попробуй через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Проверка кода при логине — 10 за 15 минут с IP
const verifyLoginCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток ввода кода. Попробуй через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Запрос нового кода при логине — 3 за час
const resendLoginCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Слишком много запросов кода. Попробуй через час.' },
  standardHeaders: true,
  legacyHeaders: false,
})

module.exports = {
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
}