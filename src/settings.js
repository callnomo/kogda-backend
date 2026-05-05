import { useState, useEffect } from 'react'
import axios from 'axios'
import { User, Clock, BookOpen, Settings as SettingsIcon, Bell, Mail, MessageCircle } from 'lucide-react'

const API = 'https://kogda-backend-production.up.railway.app'

const NavItem = ({ icon: Icon, label, href, active }) => (
  <a href={href} style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', borderRadius: 10, textDecoration: 'none',
    background: active ? '#E8FF47' : 'transparent',
    color: '#111', fontSize: 14, fontWeight: active ? 700 : 500,
  }}>
    <Icon size={16} strokeWidth={active ? 2.5 : 2} />
    {label}
  </a>
)

const Toggle = ({ value, onChange }) => (
  <div onClick={() => onChange(!value)} style={{
    width: 44, height: 24, borderRadius: 12,
    background: value ? '#111' : '#E0E0D8',
    cursor: 'pointer', position: 'relative', flexShrink: 0,
    transition: 'background 0.2s'
  }}>
    <div style={{
      width: 18, height: 18, borderRadius: 9, background: '#fff',
      position: 'absolute', top: 3,
      left: value ? 23 : 3,
      transition: 'left 0.2s'
    }} />
  </div>
)

export default function Settings() {
  const [user, setUser] = useState(null)
  const [form, setForm] = useState({ name: '', bio: '', slug: '' })
  const [notifications, setNotifications] = useState({
    notify_telegram: true,
    notify_email: true,
    notify_whatsapp: false,
    notify_max: false,
    whatsapp_phone: '',
    max_phone: ''
  })
  const [payments, setPayments] = useState({
    payment_sbp: false, payment_tinkoff: false, payment_sber: false,
    payment_kaspi: false, payment_paypal: false, payment_wise: false,
    payment_usdt: false, payment_bank: false, payment_other: ''
  })
  const [paymentSaved, setPaymentSaved] = useState(false)
  const [notifSaved, setNotifSaved] = useState(false)
  const [telegramLink, setTelegramLink] = useState(null)
  const [telegramConnected, setTelegramConnected] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const u = localStorage.getItem('user')
    if (!u) { window.location.href = '/login'; return }
    loadSettings()
  }, [])

  const loadSettings = async () => {
    const token = localStorage.getItem('token')
    try {
      const res = await axios.get(`${API}/settings`, { headers: { Authorization: `Bearer ${token}` } })
      setUser(res.data)
      setForm({ name: res.data.name, bio: res.data.bio || '', slug: res.data.slug })
      setTelegramConnected(!!res.data.telegram_chat_id)
      setNotifications({
        notify_telegram: res.data.notify_telegram ?? true,
        notify_email: res.data.notify_email ?? true,
        notify_whatsapp: res.data.notify_whatsapp ?? false,
        notify_max: res.data.notify_max ?? false,
        whatsapp_phone: res.data.whatsapp_phone || '',
        max_phone: res.data.max_phone || ''
      })
      setPayments({
        payment_sbp: res.data.payment_sbp ?? false,
        payment_tinkoff: res.data.payment_tinkoff ?? false,
        payment_sber: res.data.payment_sber ?? false,
        payment_kaspi: res.data.payment_kaspi ?? false,
        payment_paypal: res.data.payment_paypal ?? false,
        payment_wise: res.data.payment_wise ?? false,
        payment_usdt: res.data.payment_usdt ?? false,
        payment_bank: res.data.payment_bank ?? false,
        payment_other: res.data.payment_other || ''
      })
    } catch (err) { console.error(err) }
  }

  const saveProfile = async (e) => {
    e.preventDefault()
    const token = localStorage.getItem('token')
    try {
      const res = await axios.patch(`${API}/settings/profile`, form, { headers: { Authorization: `Bearer ${token}` } })
      localStorage.setItem('user', JSON.stringify(res.data))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка сохранения')
    }
  }

  const savePayments = async () => {
    const token = localStorage.getItem('token')
    try {
      await axios.patch(`${API}/settings/payments`, payments, { headers: { Authorization: `Bearer ${token}` } })
      setPaymentSaved(true)
      setTimeout(() => setPaymentSaved(false), 3000)
    } catch (err) { console.error(err) }
  }

  const saveNotifications = async () => {
    const token = localStorage.getItem('token')
    try {
      await axios.patch(`${API}/settings/notifications`, notifications, { headers: { Authorization: `Bearer ${token}` } })
      setNotifSaved(true)
      setTimeout(() => setNotifSaved(false), 3000)
    } catch (err) { console.error(err) }
  }

  const connectTelegram = async () => {
    setLoading(true)
    const token = localStorage.getItem('token')
    try {
      const res = await axios.post(`${API}/settings/telegram/token`, {}, { headers: { Authorization: `Bearer ${token}` } })
      setTelegramLink(res.data.link)
      const interval = setInterval(async () => {
        try {
          const check = await axios.get(`${API}/settings`, { headers: { Authorization: `Bearer ${token}` } })
          if (check.data.telegram_chat_id) {
            setTelegramConnected(true)
            setTelegramLink(null)
            clearInterval(interval)
          }
        } catch {}
      }, 2000)
      setTimeout(() => clearInterval(interval), 300000)
    } catch (err) { console.error(err) }
    setLoading(false)
  }

  if (!user) return null

  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: '1.5px solid #E0E0D8', fontSize: 15, outline: 'none',
    boxSizing: 'border-box', fontFamily: 'Inter, sans-serif'
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F7F6F1', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #E8E7E0', padding: '16px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, fontFamily: 'Syne, sans-serif' }}>
          kog<span style={{ background: '#E8FF47', padding: '0 6px', borderRadius: 6 }}>DA</span>
        </h1>
        <button onClick={() => { localStorage.clear(); window.location.href = '/login' }}
          style={{ background: 'transparent', border: '1.5px solid #E0E0D8', padding: '8px 16px', borderRadius: 100, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Выйти
        </button>
      </div>

      <div style={{ display: 'flex', maxWidth: 1100, margin: '0 auto', padding: '40px 24px', gap: 32 }}>
        <div style={{ width: 200, flexShrink: 0 }}>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <NavItem icon={User} label="Мой кабинет" href="/dashboard" active={false} />
            <NavItem icon={Clock} label="Расписание" href="/schedule" active={false} />
            <NavItem icon={BookOpen} label="Записи" href="/bookings" active={false} />
            <NavItem icon={SettingsIcon} label="Настройки" href="/settings" active={true} />
          </nav>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Настройки</h2>
            <p style={{ color: '#888', marginTop: 6, fontSize: 15 }}>Управляй своим профилем и уведомлениями</p>
          </div>

          {/* Telegram */}
          <div style={{ background: '#fff', borderRadius: 20, padding: '28px', border: '1px solid #E8E7E0', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: '#229ED9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>✈️</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Telegram</div>
                <div style={{ fontSize: 13, color: '#888' }}>Уведомления о новых записях</div>
              </div>
              {telegramConnected && (
                <div style={{ background: '#DCFCE7', color: '#16A34A', padding: '4px 12px', borderRadius: 100, fontSize: 12, fontWeight: 600 }}>
                  ✓ Подключён
                </div>
              )}
            </div>

            {telegramConnected ? (
              <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#16A34A' }}>
                Telegram подключён! Уведомления приходят в бот.
              </div>
            ) : telegramLink ? (
              <div>
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: '12px 16px', marginBottom: 12, fontSize: 14, color: '#92400E' }}>
                  Нажми кнопку ниже и нажми START в Telegram
                </div>
                <a href={telegramLink} target="_blank" rel="noreferrer" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#229ED9', color: '#fff', padding: '12px 24px',
                  borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none'
                }}>
                  ✈️ Открыть бота
                </a>
              </div>
            ) : (
              <button onClick={connectTelegram} disabled={loading} style={{
                background: '#229ED9', color: '#fff', border: 'none',
                padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer'
              }}>
                {loading ? 'Генерируем...' : '✈️ Подключить Telegram'}
              </button>
            )}
          </div>

          {/* Notifications */}
          <div style={{ background: '#fff', borderRadius: 20, padding: '28px', border: '1px solid #E8E7E0', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Bell size={18} color="#111" />
              <div style={{ fontSize: 16, fontWeight: 700 }}>Куда присылать уведомления</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Telegram */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>✈️</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Telegram</div>
                    <div style={{ fontSize: 12, color: '#888' }}>Мгновенные уведомления в бот</div>
                  </div>
                </div>
                <Toggle value={notifications.notify_telegram} onChange={v => setNotifications({...notifications, notify_telegram: v})} />
              </div>

              {/* Email */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Mail size={20} color="#888" />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Email</div>
                    <div style={{ fontSize: 12, color: '#888' }}>Уведомления на почту</div>
                  </div>
                </div>
                <Toggle value={notifications.notify_email} onChange={v => setNotifications({...notifications, notify_email: v})} />
              </div>

              {/* WhatsApp */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: notifications.notify_whatsapp ? 10 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <MessageCircle size={20} color="#25D366" />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>WhatsApp</div>
                      <div style={{ fontSize: 12, color: '#888' }}>Скоро</div>
                    </div>
                  </div>
                  <Toggle value={notifications.notify_whatsapp} onChange={v => setNotifications({...notifications, notify_whatsapp: v})} />
                </div>
                {notifications.notify_whatsapp && (
                  <input value={notifications.whatsapp_phone} onChange={e => setNotifications({...notifications, whatsapp_phone: e.target.value})}
                    placeholder="+7 999 123 45 67" style={{ ...inputStyle, fontSize: 14, marginTop: 8 }} />
                )}
              </div>

              {/* Макс */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: notifications.notify_max ? 10 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <MessageCircle size={20} color="#0077FF" />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>Макс</div>
                      <div style={{ fontSize: 12, color: '#888' }}>Скоро</div>
                    </div>
                  </div>
                  <Toggle value={notifications.notify_max} onChange={v => setNotifications({...notifications, notify_max: v})} />
                </div>
                {notifications.notify_max && (
                  <input value={notifications.max_phone} onChange={e => setNotifications({...notifications, max_phone: e.target.value})}
                    placeholder="+7 999 123 45 67" style={{ ...inputStyle, fontSize: 14, marginTop: 8 }} />
                )}
              </div>

            </div>

            <button onClick={saveNotifications} style={{
              marginTop: 20, background: notifSaved ? '#22C55E' : '#111', color: '#fff',
              border: 'none', padding: '12px 28px', borderRadius: 10,
              fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'background 0.3s'
            }}>
              {notifSaved ? '✓ Сохранено!' : 'Сохранить'}
            </button>
          </div>

          {/* Способы оплаты */}
          <div style={{ background: '#fff', borderRadius: 20, padding: '28px', border: '1px solid #E8E7E0', marginBottom: 20 }}>
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Способы оплаты</h3>
              <p style={{ color: '#888', fontSize: 13, margin: 0 }}>Отметь как клиенты могут оплатить сессию. Реквизиты отправляй сам в Telegram после бронирования.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                { key: 'payment_sbp', label: 'СБП' },
                { key: 'payment_tinkoff', label: 'Тинькофф' },
                { key: 'payment_sber', label: 'Сбербанк' },
                { key: 'payment_kaspi', label: 'Kaspi' },
                { key: 'payment_paypal', label: 'PayPal' },
                { key: 'payment_wise', label: 'Wise' },
                { key: 'payment_usdt', label: 'USDT (крипто)' },
                { key: 'payment_bank', label: 'Банковский перевод' },
              ].map(p => (
                <div key={p.key} onClick={() => setPayments({...payments, [p.key]: !payments[p.key]})}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 14px', borderRadius: 10, cursor: 'pointer',
                    border: `1.5px solid ${payments[p.key] ? '#111' : '#E8E7E0'}`,
                    background: payments[p.key] ? '#F7F6F1' : '#fff',
                    transition: 'all 0.15s'
                  }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    background: payments[p.key] ? '#111' : '#fff',
                    border: `2px solid ${payments[p.key] ? '#111' : '#E0E0D8'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {payments[p.key] && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{p.label}</span>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Другое</label>
              <input value={payments.payment_other} onChange={e => setPayments({...payments, payment_other: e.target.value})}
                placeholder="Revolut, Stripe, наличные..." style={inputStyle} />
            </div>
            <button onClick={savePayments} style={{
              background: paymentSaved ? '#22C55E' : '#111', color: '#fff',
              border: 'none', padding: '12px 28px', borderRadius: 10,
              fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'background 0.3s'
            }}>
              {paymentSaved ? '✓ Сохранено!' : 'Сохранить'}
            </button>
          </div>

          {/* Profile */}
          <div style={{ background: '#fff', borderRadius: 20, padding: '28px', border: '1px solid #E8E7E0' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Профиль</div>
            <form onSubmit={saveProfile}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Имя</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Никнейм (для ссылки)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, color: '#888', whiteSpace: 'nowrap' }}>app.kogda.app/</span>
                  <input value={form.slug} onChange={e => setForm({...form, slug: e.target.value.toLowerCase().replace(/\s/g,'-')})}
                    placeholder="anna-sokolova" style={{ ...inputStyle, flex: 1 }} />
                </div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>О себе</label>
                <textarea value={form.bio} onChange={e => setForm({...form, bio: e.target.value})}
                  placeholder="Психолог, КПТ, 5 лет практики..."
                  style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }} />
              </div>
              <button type="submit" style={{
                background: saved ? '#22C55E' : '#111', color: '#fff',
                border: 'none', padding: '14px 32px', borderRadius: 12,
                fontSize: 15, fontWeight: 700, cursor: 'pointer', transition: 'background 0.3s'
              }}>
                {saved ? '✓ Сохранено!' : 'Сохранить профиль'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}