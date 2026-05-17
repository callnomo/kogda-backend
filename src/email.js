const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

const formatDate = (dateStr) => {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

const LOGO_HTML = `
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 32px;" align="center">
  <tr>
    <td style="text-align:center;">
      <img src="https://kogda.app/kogda-logo.png" alt="kogDA" width="142" style="display:block;border:0;outline:none;text-decoration:none;height:auto;width:142px;">
    </td>
  </tr>
</table>
`

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
        Здравствуйте, ${clientName}! Вы записаны к ${expertName}.
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
        Сохраните это письмо — ссылка на встречу и управление записью всегда здесь.
      </p>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
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
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;">Здравствуйте, ${clientName}! Напоминаем о Вашей встрече.</p>
      <div style="background:#F7F6F1;border-radius:16px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:15px;font-weight:700;">${meetingTitle}</p>
        <p style="margin:0;color:#888;font-size:14px;">${formatDate(date)} в ${time}</p>
      </div>
      <a href="${videoLink}" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;">Войти на встречу</a>
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
      ${requireConfirm ?
`
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
      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">Сброс пароля</h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;">
        Привет! Кто-то запросил сброс пароля для твоего аккаунта.
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

const sendVerificationCode = async (email, code) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: email,
      subject: `${code} — код подтверждения kogDA`,
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
      ${iconCircle('✉️')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Код подтверждения
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;">
        Привет! Введи этот код на странице регистрации, чтобы подтвердить email.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:32px;margin-bottom:24px;text-align:center;">
        <div style="font-size:42px;font-weight:800;color:#111;letter-spacing:8px;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;">
          ${code}
        </div>
      </div>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Код действителен <b style="color:#111;">10 минут</b>. Если ты не запрашивал код — просто проигнорируй это письмо.
        </p>
      </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>
  </div>
</body>
</html>
      `
    })
    console.log('Verification code отправлен:', email)
  } catch (err) {
    console.error('Verification code error:', err.message)
  }
}

const sendEmailTakenWarning = async (email, name) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: email,
      subject: 'Попытка регистрации на твой email — kogDA',
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
      ${iconCircle('⚠️')}
      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#111;margin:0 0 8px;">
        Попытка регистрации
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;">
        Привет${name ? `, ${name}` : ''}! Кто-то пытался зарегистрировать аккаунт на твой email <b style="color:#111;">${email}</b>, но у тебя уже есть учётка в kogDA.
      </p>
      <a href="https://app.kogda.app/login" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:20px;">
        Войти в kogDA
      </a>
      <div style="background:#F7F6F1;border-radius:12px;padding:16px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Если это был ты — просто войди в аккаунт. Если нет — игнорируй это письмо, никаких действий не требуется. Твой аккаунт в безопасности.
        </p>
      </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>
  </div>
</body>
</html>
      `
    })
    console.log('Email-taken warning отправлен:', email)
  } catch (err) {
    console.error('Email-taken warning error:', err.message)
  }
}

// ===== Отмена записи клиенту (когда коуч удаляет аккаунт) =====
const sendBookingCancelledByCoachEmail = async (clientEmail, clientName, meetingTitle, date, time, expertName) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: clientEmail,
      subject: `Встреча отменена — ${meetingTitle}`,
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
      ${iconCircle('🗓')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Встреча отменена
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;">
        Здравствуйте, ${clientName}! К сожалению, Ваша встреча с <b style="color:#111;">${expertName}</b> отменена.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:24px;margin-bottom:24px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Встреча</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${meetingTitle}</div>
        </div>
        <div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Дата и время</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${formatDate(date)} в ${time}</div>
        </div>
      </div>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Если у Вас есть контакты специалиста — свяжитесь с ним напрямую. Никаких действий с Вашей стороны больше не требуется.
        </p>
      </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>

  </div>
</body>
</html>
      `
    })
    console.log('Booking cancelled email отправлен:', clientEmail)
  } catch (err) {
    console.error('Booking cancelled email error:', err.message)
  }
}

// ===== Просьба перенести — КЛИЕНТУ (на ВЫ). Коуч просит выбрать новое время. =====
const sendBookingRescheduleRequestByCoachEmail = async (clientEmail, clientName, meetingTitle, date, time, expertName, rebookSlug) => {
  const rebookUrl = rebookSlug ? `https://app.kogda.app/${rebookSlug}` : null
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: clientEmail,
      subject: `Нужно перенести встречу — ${meetingTitle}`,
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
      ${iconCircle('🔄')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Нужно перенести встречу
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;line-height:1.5;">
        Здравствуйте, ${clientName}! К сожалению, ${expertName} просит перенести встречу. Пожалуйста, выберите другое удобное для Вас время.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:24px;margin-bottom:24px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Встреча</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${meetingTitle}</div>
        </div>
        <div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Было запланировано на</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${formatDate(date)} в ${time}</div>
        </div>
      </div>

      ${rebookUrl ? `
      <a href="${rebookUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:20px;">
        Выбрать новое время
      </a>
      <p style="text-align:center;color:#aaa;font-size:12px;margin:0;line-height:1.6;">
        Кнопка не работает? Скопируйте ссылку:<br>
        <span style="color:#111;word-break:break-all;">${rebookUrl}</span>
      </p>
      ` : `
      <div style="background:#F7F6F1;border-radius:12px;padding:16px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Свяжитесь со специалистом напрямую, чтобы договориться о новом времени.
        </p>
      </div>
      `}
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>

  </div>
</body>
</html>
      `
    })
    console.log('Booking reschedule request email отправлен:', clientEmail)
  } catch (err) {
    console.error('Booking reschedule request email error:', err.message)
  }
}

// ===== Подтверждение удаления аккаунта коучу =====
const sendAccountDeletionEmail = async (email, name, scheduledDeleteDate, cancelledBookingsCount) => {
  try {
    const date = new Date(scheduledDeleteDate)
    const dateStr = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`

    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: email,
      subject: 'Аккаунт помечен на удаление — kogDA',
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
      ${iconCircle('🗑')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Аккаунт помечен на удаление
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;">
        ${name ? `${name}, ` : ''}мы получили запрос на удаление твоего аккаунта в kogDA.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:24px;margin-bottom:24px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Окончательное удаление</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${dateStr}</div>
        </div>
        ${cancelledBookingsCount > 0 ? `
        <div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Отменено будущих записей</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${cancelledBookingsCount}</div>
        </div>
        ` : ''}
      </div>

      <div style="background:#FFF7ED;border-radius:12px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#92400E;font-size:14px;line-height:1.6;">
          <b>Передумал?</b> У тебя есть 30 дней, чтобы восстановить аккаунт. Просто войди снова — все данные вернутся.
        </p>
      </div>

      <a href="https://app.kogda.app/login" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:20px;">
        Войти и восстановить
      </a>

      <p style="text-align:center;color:#aaa;font-size:13px;margin:0;line-height:1.6;">
        После ${dateStr} все данные удалятся навсегда. Если это был не ты — войди в аккаунт прямо сейчас и смени пароль в настройках.
      </p>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>

  </div>
</body>
</html>
      `
    })
    console.log('Account deletion email отправлен:', email)
  } catch (err) {
    console.error('Account deletion email error:', err.message)
  }
}

// ===== Код подтверждения смены email (на НОВЫЙ адрес) =====
const sendEmailChangeCode = async (newEmail, code) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: newEmail,
      subject: `${code} — код подтверждения нового email`,
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
      ${iconCircle('✉️')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Подтверди новый email
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;">
        Кто-то хочет привязать этот email к аккаунту в kogDA. Если это ты — введи код в настройках.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:32px;margin-bottom:24px;text-align:center;">
        <div style="font-size:42px;font-weight:800;color:#111;letter-spacing:8px;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;">
          ${code}
        </div>
      </div>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Код действителен <b style="color:#111;">10 минут</b>. Если ты не запрашивал — просто проигнорируй это письмо.
        </p>
      </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>
  </div>
</body>
</html>
      `
    })
    console.log('Email change code отправлен:', newEmail)
  } catch (err) {
    console.error('Email change code error:', err.message)
  }
}

// ===== Уведомление о смене email (на СТАРЫЙ адрес для безопасности) =====
const sendEmailChangedNotification = async (oldEmail, name, newEmailMasked) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: oldEmail,
      subject: 'Email в kogDA изменён',
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
      ${iconCircle('🔒')}

      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#111;margin:0 0 8px;">
        Email в kogDA изменён
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;">
        ${name ? `${name}, ` : ''}email твоего аккаунта изменён на <b style="color:#111;">${newEmailMasked}</b>.
      </p>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;margin-bottom:20px;">
        <p style="margin:0 0 8px;color:#111;font-size:14px;font-weight:600;">
          Это был ты?
        </p>
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Используй новый email для входа. Это письмо — просто уведомление, ничего делать не нужно.
        </p>
      </div>

      <div style="background:#FEF3C7;border-radius:12px;padding:16px;margin-bottom:24px;">
        <p style="margin:0 0 8px;color:#92400E;font-size:14px;font-weight:600;">
          ⚠️ Это был не ты?
        </p>
        <p style="margin:0;color:#92400E;font-size:13px;line-height:1.6;">
          Срочно напиши на <a href="mailto:support@kogda.app" style="color:#92400E;font-weight:600;">support@kogda.app</a> — мы откатим изменение.
        </p>
      </div>

      <p style="color:#aaa;font-size:12px;text-align:center;margin:0;line-height:1.6;">
        Письмо отправлено через kogDA для безопасности.
      </p>
    </div>
  </div>
</body>
</html>
      `
    })
    console.log('Email changed notification отправлен:', oldEmail)
  } catch (err) {
    console.error('Email changed notification error:', err.message)
  }
}

// ===== Код подтверждения логина с нового устройства =====
const sendLoginVerificationCode = async (email, code, deviceLabel, city) => {
  const locationStr = city ? ` из ${city}` : ''
  const deviceStr = deviceLabel || 'нового устройства'
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: email,
      subject: `${code} — код для входа в kogDA`,
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
      ${iconCircle('🔐')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Подтверди вход
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;line-height:1.5;">
        Кто-то пытается войти в твой kogDA с <b style="color:#111;">${deviceStr}</b>${locationStr}.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:32px;margin-bottom:24px;text-align:center;">
        <div style="font-size:42px;font-weight:800;color:#111;letter-spacing:8px;font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;">
          ${code}
        </div>
      </div>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;margin-bottom:16px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Код действителен <b style="color:#111;">10 минут</b>. Введи его на странице входа.
        </p>
      </div>

      <div style="background:#FEF3C7;border-radius:12px;padding:16px;">
        <p style="margin:0 0 8px;color:#92400E;font-size:14px;font-weight:600;">
          ⚠️ Это был не ты?
        </p>
        <p style="margin:0;color:#92400E;font-size:13px;line-height:1.6;">
          Не вводи код. Кто-то знает твой пароль — срочно <a href="https://app.kogda.app/forgot-password" style="color:#92400E;font-weight:600;">смени его</a>.
        </p>
      </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>
  </div>
</body>
</html>
      `
    })
    console.log('Login verification code отправлен:', email)
  } catch (err) {
    console.error('Login verification code error:', err.message)
  }
}

// ===== Уведомление об успешном входе с нового устройства =====
const sendNewDeviceLoginNotification = async (email, name, deviceLabel, city, country, ip) => {
  const locationStr = city ? `${city}${country ? ', ' + country : ''}` : (ip || 'неизвестное место')
  const now = new Date()
  const timeStr = now.toLocaleString('ru-RU', {
    day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC'
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: email,
      subject: 'Новый вход в kogDA',
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
      ${iconCircle('🔓')}

      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#111;margin:0 0 8px;">
        Новый вход в kogDA
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;">
        ${name ? `${name}, ` : ''}в твой аккаунт вошли с нового устройства.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:24px;margin-bottom:24px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Устройство</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${deviceLabel || 'Неизвестно'}</div>
        </div>
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Локация</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${locationStr}</div>
        </div>
        <div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Когда</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${timeStr}</div>
        </div>
      </div>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;margin-bottom:16px;">
        <p style="margin:0 0 8px;color:#111;font-size:14px;font-weight:600;">
          Это был ты?
        </p>
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Отлично, тогда ничего делать не нужно. Это письмо — просто для безопасности.
        </p>
      </div>

      <div style="background:#FEF3C7;border-radius:12px;padding:16px;margin-bottom:24px;">
        <p style="margin:0 0 8px;color:#92400E;font-size:14px;font-weight:600;">
          ⚠️ Это был не ты?
        </p>
        <p style="margin:0;color:#92400E;font-size:13px;line-height:1.6;">
          Срочно <a href="https://app.kogda.app/forgot-password" style="color:#92400E;font-weight:600;">смени пароль</a> и зайди в Настройки → Безопасность → отзови это устройство. Если что-то непонятно — напиши на <a href="mailto:support@kogda.app" style="color:#92400E;font-weight:600;">support@kogda.app</a>.
        </p>
      </div>

      <p style="color:#aaa;font-size:12px;text-align:center;margin:0;line-height:1.6;">
        Уведомление о безопасности от kogDA
      </p>
    </div>
  </div>
</body>
</html>
      `
    })
    console.log('New device login notification отправлен:', email)
  } catch (err) {
    console.error('New device login notification error:', err.message)
  }
}

// ===== НОВОЕ: запрос на запись истёк — КЛИЕНТУ (на ВЫ) =====
const sendBookingExpiredClient = async (clientEmail, clientName, meetingTitle, date, time, expertName) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: clientEmail,
      subject: `Запрос на запись истёк — ${meetingTitle}`,
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
      ${iconCircle('⌛')}

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Запрос на запись истёк
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;line-height:1.5;">
        Здравствуйте, ${clientName}! К сожалению, специалист${expertName ? ` ${expertName}` : ''} не подтвердил Ваш запрос вовремя, и время встречи прошло.
      </p>

      <div style="background:#F7F6F1;border-radius:16px;padding:24px;margin-bottom:24px;">
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Встреча</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${meetingTitle}</div>
        </div>
        <div>
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Было запрошено на</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${formatDate(date)} в ${time}</div>
        </div>
      </div>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          Если встреча всё ещё нужна — попробуйте записаться снова или свяжитесь со специалистом напрямую.
        </p>
      </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>

  </div>
</body>
</html>
      `
    })
    console.log('Booking expired (client) email отправлен:', clientEmail)
  } catch (err) {
    console.error('Booking expired (client) email error:', err.message)
  }
}

// ===== НОВОЕ: запрос истёк и отменён — КОУЧУ (на ты) =====
const sendBookingExpiredCoach = async (coachEmail, coachName, clientName, clientEmail, meetingTitle, date, time) => {
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: coachEmail,
      subject: `Запрос от ${clientName} истёк и отменён`,
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
      ${iconCircle('⌛')}

      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#111;margin:0 0 8px;">
        Запрос истёк и отменён
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;line-height:1.5;">
        Привет${coachName ? `, ${coachName}` : ''}! Запрос не был подтверждён вовремя, время встречи прошло. Мы отменили его автоматически, клиент получил уведомление.
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
          <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Было запрошено на</div>
          <div style="font-size:16px;font-weight:700;color:#111;">${formatDate(date)} в ${time}</div>
        </div>
      </div>

      <div style="background:#F7F6F1;border-radius:12px;padding:16px;">
        <p style="margin:0;color:#888;font-size:13px;line-height:1.6;">
          На будущее: подтверждай или отклоняй запросы вовремя, чтобы клиенты не оставались без ответа.
        </p>
      </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>

  </div>
</body>
</html>
      `
    })
    console.log('Booking expired (coach) email отправлен:', coachEmail)
  } catch (err) {
    console.error('Booking expired (coach) email error:', err.message)
  }
}

// ===== НОВОЕ: висящий запрос ждёт ответа — КОУЧУ (на ты) =====
const sendPendingReminderCoach = async (coachEmail, coachName, clientName, clientEmail, meetingTitle, date, time) => {
  const confirmUrl = 'https://app.kogda.app/bookings'
  try {
    await resend.emails.send({
      from: 'kogDA <noreply@kogda.app>',
      to: coachEmail,
      subject: `Запрос от ${clientName} ждёт ответа`,
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
      ${iconCircle('⏳')}

      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#111;margin:0 0 8px;">
        Запрос ждёт ответа
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;line-height:1.5;">
        Привет${coachName ? `, ${coachName}` : ''}! Клиент ждёт подтверждения. Если не ответить — запрос отменится автоматически после времени встречи.
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

      <a href="${confirmUrl}" style="display:block;background:#111;color:#fff;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;">
        Подтвердить или отклонить
      </a>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">Письмо отправлено через kogDA</p>
    </div>

  </div>
</body>
</html>
      `
    })
    console.log('Pending reminder (coach) email отправлен:', coachEmail)
  } catch (err) {
    console.error('Pending reminder (coach) email error:', err.message)
  }
}

module.exports = {
  sendBookingConfirmation,
  sendReminder,
  sendCoachNotification,
  sendResetPasswordEmail,
  sendVerificationCode,
  sendEmailTakenWarning,
  sendBookingCancelledByCoachEmail,
  sendBookingRescheduleRequestByCoachEmail,
  sendAccountDeletionEmail,
  sendEmailChangeCode,
  sendEmailChangedNotification,
  sendLoginVerificationCode,
  sendNewDeviceLoginNotification,
  sendBookingExpiredClient,
  sendBookingExpiredCoach,
  sendPendingReminderCoach,
}