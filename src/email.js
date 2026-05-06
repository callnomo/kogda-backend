const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

const formatDate = (dateStr) => {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

// Логотип kogDA — единый для всех писем
const LOGO_HTML = `
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 32px;" align="center">
  <tr>
    <td style="text-align:center;">
      <img src="https://kogda.app/kogda-logo.png" alt="kogDA" width="120" style="display:block;border:0;outline:none;text-decoration:none;height:auto;width:120px;">
    </td>
  </tr>
</table>
`

// Иконка в кружке (lime). Через table для совместимости с Mail.ru/Gmail.
const iconCircle = (emoji) => `
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;" align="center">
  <tr>
    <td width="64" height="64" align="center" valign="middle" style="background:#E8FF47;border-radius:32px;font-size:28px;line-height:64px;text-align:center;">
      ${emoji}
    </td>
  </tr>
</table>
`

const sendBookingConfirmation = async (clientEmail, clientName, meetingTitle, date, time, videoLink, expertName, clientToken) => {
  const manageLink = `https://app.kogda.app/booking/${clientToken}`
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: clientEmail,
      subject: `Встреча подтверждена — ${meetingTitle}`,
      html: `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F7F6F1;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">

    ${LOGO_HTML}

    <div style="background:#fff;border-radius:24px;padding:40px;border:1px solid #E8E7E0;">
      ${iconCircle('✓')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Встреча подтверждена!
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;">
        Привет, ${clientName}! Ты записан к ${expertName}.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:24px;margin-bottom:24px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Встреча</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${meetingTitle}</div>
        </div>
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Дата и время</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${formatDate(date)} в ${time}</div>
        </div>
        <div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Эксперт</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${expertName}</div>
        </div>
      </div>

      <a href="${videoLink}" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:12px;">
        Войти на встречу
      </a>

      <a href="${manageLink}" style="display:block;background:#F7F6F1;color:#111;text-align:center;padding:14px;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none;margin-bottom:24px;">
        Перенести или отменить
      </a>

      <p style="text-align:center;color:#888;font-size:13px;margin:0;">
        Сохрани это письмо — ссылка на встречу и управление записью всегда здесь.
      </p>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">
        Письмо отправлено через kogDA
      </p>
    </div>

  </div>
</body>
</html>
      `
    })
    console.log('Email отправлен:', clientEmail)
  } catch (err) {
    console.error('Email error:', err.message)
  }
}

const sendReminder = async (clientEmail, clientName, meetingTitle, date, time, videoLink) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: clientEmail,
      subject: `Напоминание — встреча завтра: ${meetingTitle}`,
      html: `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F7F6F1;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">

    ${LOGO_HTML}

    <div style="background:#fff;border-radius:24px;padding:40px;border:1px solid #E8E7E0;">
      ${iconCircle('⏰')}
      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#111;margin:0 0 8px;">Встреча завтра!</h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;">Привет, ${clientName}! Напоминаем о твоей встрече.</p>
      <div style="background:#F7F6F1;border-radius:16px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:15px;font-weight:700;">${meetingTitle}</p>
        <p style="margin:0;color:#888;font-size:14px;">${formatDate(date)} в ${time}</p>
      </div>
      <a href="${videoLink}" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;">
        Войти на встречу
      </a>
    </div>
  </div>
</body>
</html>
      `
    })
  } catch (err) {
    console.error('Reminder email error:', err.message)
  }
}

const sendCoachNotification = async (coachEmail, coachName, clientName, clientEmail, meetingTitle, date, time, bookingId, requireConfirm) => {
  const appUrl = 'https://app.kogda.app'
  const confirmUrl = `${appUrl}/bookings`
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: coachEmail,
      subject: requireConfirm ? `Новая заявка от ${clientName} — требует подтверждения` : `Новая запись от ${clientName}`,
      html: `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F7F6F1;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">

    ${LOGO_HTML}

    <div style="background:#fff;border-radius:24px;padding:40px;border:1px solid #E8E7E0;">
      ${iconCircle(requireConfirm ? '⏳' : '🎉')}
      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#111;margin:0 0 8px;">
        ${requireConfirm ? 'Новая заявка!' : 'Новая запись!'}
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;">
        Привет, ${coachName}! ${requireConfirm ? 'Клиент хочет записаться — подтверди или отклони.' : 'К тебе записался новый клиент.'}
      </p>
      <div style="background:#F7F6F1;border-radius:16px;padding:24px;margin-bottom:24px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Клиент</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${clientName}</div>
          <div style="font-size:13px;color:#888;">${clientEmail}</div>
        </div>
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Встреча</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${meetingTitle}</div>
        </div>
        <div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Дата и время</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${formatDate(date)} в ${time}</div>
        </div>
      </div>
      ${requireConfirm ? `
      <a href="${confirmUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:12px;">
        Подтвердить или отклонить
      </a>
      ` : `
      <a href="${confirmUrl}" style="display:block;background:#F7F6F1;color:#111;text-align:center;padding:14px;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none;">
        Посмотреть все записи
      </a>
      `}
    </div>
  </div>
</body>
</html>
      `
    })
    console.log('Coach email отправлен:', coachEmail)
  } catch (err) {
    console.error('Coach email error:', err.message)
  }
}

const sendResetPasswordEmail = async (email, name, resetLink) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: email,
      subject: 'Сброс пароля — kogDA',
      html: `
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F7F6F1;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">

    ${LOGO_HTML}

    <div style="background:#fff;border-radius:24px;padding:40px;border:1px solid #E8E7E0;">
      ${iconCircle('🔑')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Сброс пароля
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;">
        Привет, ${name}! Кто-то запросил сброс пароля для твоего аккаунта.
      </p>

      <a href="${resetLink}" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:20px;">
        Создать новый пароль
      </a>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Ссылка действительна <b style="color:#111;">1 час</b>. Если ты не запрашивал сброс — просто проигнорируй это письмо, твой пароль останется прежним.
        </p>
      </div>

      <p style="color:#aaa;font-size:12px;text-align:center;margin:0;line-height:1.6;">
        Кнопка не работает? Скопируй ссылку:<br>
        <span style="color:#111;word-break:break-all;">${resetLink}</span>
      </p>
    </div>

  </div>
</body>
</html>
      `
    })
    console.log('Reset email отправлен:', email)
  } catch (err) {
    console.error('Reset email error:', err.message)
  }
}

module.exports = { sendBookingConfirmation, sendReminder, sendCoachNotification, sendResetPasswordEmail }