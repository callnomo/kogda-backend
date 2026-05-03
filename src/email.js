const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

const formatDate = (dateStr) => {
  const d = new Date(dateStr)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

// Подтверждение бронирования клиенту
const sendBookingConfirmation = async (clientEmail, clientName, meetingTitle, date, time, videoLink, expertName) => {
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
<title>Встреча подтверждена</title>
</head>
<body style="margin:0;padding:0;background:#F7F6F1;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">

    <!-- Logo -->
    <div style="text-align:center;margin-bottom:32px;">
      <span style="font-size:24px;font-weight:800;color:#111;">kog</span><span style="background:#E8FF47;padding:2px 8px;border-radius:6px;font-size:24px;font-weight:800;color:#111;">DA</span>
    </div>

    <!-- Card -->
    <div style="background:#fff;border-radius:24px;padding:40px;border:1px solid #E8E7E0;">

      <!-- Check icon -->
      <div style="width:64px;height:64px;background:#E8FF47;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;text-align:center;line-height:64px;font-size:28px;">
        ✓
      </div>

      <h1 style="text-align:center;font-size:24px;font-weight:800;color:#111;margin:0 0 8px;">
        Встреча подтверждена!
      </h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 32px;">
        Привет, ${clientName}! Ты записан к ${expertName}.
      </p>

      <!-- Meeting details -->
      <div style="background:#F7F6F1;border-radius:16px;padding:24px;margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
          <span style="font-size:20px;">📅</span>
          <div>
            <div style="font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Встреча</div>
            <div style="font-size:16px;font-weight:700;color:#111;">${meetingTitle}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
          <span style="font-size:20px;">🗓</span>
          <div>
            <div style="font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Дата и время</div>
            <div style="font-size:16px;font-weight:700;color:#111;">${formatDate(date)} в ${time}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:20px;">📹</span>
          <div>
            <div style="font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Видеозвонок</div>
            <div style="font-size:14px;color:#111;">Ссылка ниже</div>
          </div>
        </div>
      </div>

      <!-- Video link button -->
      <a href="${videoLink}" style="display:block;background:#E8FF47;color:#111;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;margin-bottom:24px;">
        📹 Подключиться к видеозвонку
      </a>

      <p style="text-align:center;color:#888;font-size:13px;margin:0;">
        Сохрани эту ссылку — она понадобится в день встречи.<br>
        Никаких установок не нужно — просто кликни и войди.
      </p>

    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:24px;">
      <p style="color:#aaa;font-size:12px;">
        Письмо отправлено через 
        <span style="font-weight:800;color:#111;">kog</span><span style="background:#E8FF47;padding:0 4px;border-radius:3px;font-weight:800;color:#111;">DA</span>
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

// Напоминание клиенту за 24 часа
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
    <div style="text-align:center;margin-bottom:32px;">
      <span style="font-size:24px;font-weight:800;color:#111;">kog</span><span style="background:#E8FF47;padding:2px 8px;border-radius:6px;font-size:24px;font-weight:800;color:#111;">DA</span>
    </div>
    <div style="background:#fff;border-radius:24px;padding:40px;border:1px solid #E8E7E0;">
      <div style="text-align:center;font-size:40px;margin-bottom:16px;">⏰</div>
      <h1 style="text-align:center;font-size:22px;font-weight:800;color:#111;margin:0 0 8px;">Встреча завтра!</h1>
      <p style="text-align:center;color:#888;font-size:15px;margin:0 0 28px;">Привет, ${clientName}! Напоминаем о твоей встрече.</p>
      <div style="background:#F7F6F1;border-radius:16px;padding:20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:15px;"><strong>${meetingTitle}</strong></p>
        <p style="margin:0;color:#888;font-size:14px;">🗓 ${formatDate(date)} в ${time}</p>
      </div>
      <a href="${videoLink}" style="display:block;background:#E8FF47;color:#111;text-align:center;padding:16px;border-radius:12px;font-size:16px;font-weight:800;text-decoration:none;">
        📹 Ссылка на видеозвонок
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

module.exports = { sendBookingConfirmation, sendReminder }