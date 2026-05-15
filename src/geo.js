// ============================================================================
// Геолокация клиента через Cloudflare заголовки
// Используется на публичных endpoint'ах (без auth) чтобы определить:
//   - страну клиента
//   - предлагаемую валюту
//   - предлагаемый часовой пояс
//
// Cloudflare ставит заголовки cf-ipcountry, cf-ipcity, cf-connecting-ip
// автоматически если запрос проходит через CF (что у нас всегда в проде).
// ============================================================================

// Маппинг ISO 3166-1 alpha-2 country code → валюта (ISO 4217)
// Основано на официальной валюте страны. Зона евро объединена.
const COUNTRY_TO_CURRENCY = {
  // СНГ
  RU: 'RUB', UA: 'UAH', BY: 'BYN', KZ: 'KZT', KG: 'KGS', UZ: 'UZS',
  TJ: 'TJS', TM: 'TMT', MD: 'MDL', AM: 'AMD', GE: 'GEL', AZ: 'AZN',

  // США + страны где USD официальная или де-факто
  US: 'USD', EC: 'USD', SV: 'USD', ZW: 'USD', PA: 'USD',

  // Евро (Eurozone — 20 стран ЕС)
  AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR',
  FR: 'EUR', DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR',
  LT: 'EUR', LU: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR',
  SI: 'EUR', ES: 'EUR',
  // + не-ЕС страны которые используют евро
  AD: 'EUR', MC: 'EUR', SM: 'EUR', VA: 'EUR', ME: 'EUR', XK: 'EUR',

  // Остальная Европа (своя валюта)
  GB: 'GBP', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', IS: 'ISK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', RS: 'RSD',
  BA: 'BAM', MK: 'MKD', AL: 'ALL', TR: 'TRY',
  // Островные фунты
  GI: 'GIP', FK: 'FKP', IM: 'IMP', JE: 'JEP', GG: 'GGP', SH: 'SHP',

  // Канада, Австралия, Новая Зеландия
  CA: 'CAD', AU: 'AUD', NZ: 'NZD',

  // Ближний Восток
  IL: 'ILS', AE: 'AED', SA: 'SAR', QA: 'QAR', BH: 'BHD', KW: 'KWD',
  OM: 'OMR', JO: 'JOD', LB: 'LBP', SY: 'SYP', IQ: 'IQD', IR: 'IRR',
  YE: 'YER',

  // Азия
  CN: 'CNY', JP: 'JPY', KR: 'KRW', KP: 'KPW', HK: 'HKD', TW: 'TWD',
  SG: 'SGD', MY: 'MYR', TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP',
  IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', AF: 'AFN',
  MM: 'MMK', KH: 'KHR', LA: 'LAK', BN: 'BND', MN: 'MNT', BT: 'BTN',
  MO: 'MOP', MV: 'MVR',

  // Латинская Америка
  MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  UY: 'UYU', PY: 'PYG', BO: 'BOB', VE: 'VES', GT: 'GTQ', HN: 'HNL',
  NI: 'NIO', CR: 'CRC', DO: 'DOP', CU: 'CUP', HT: 'HTG', JM: 'JMD',
  TT: 'TTD', BB: 'BBD', BS: 'BSD', BZ: 'BZD', BM: 'BMD', KY: 'KYD',
  AW: 'AWG', XC: 'XCD', GY: 'GYD', SR: 'SRD',
  // Восточно-карибский доллар (использует несколько стран)
  AG: 'XCD', DM: 'XCD', GD: 'XCD', KN: 'XCD', LC: 'XCD', VC: 'XCD',

  // Африка
  ZA: 'ZAR', EG: 'EGP', NG: 'NGN', KE: 'KES', GH: 'GHS', MA: 'MAD',
  TN: 'TND', DZ: 'DZD', LY: 'LYD', SD: 'SDG', ET: 'ETB', UG: 'UGX',
  TZ: 'TZS', RW: 'RWF', BI: 'BIF', DJ: 'DJF', SO: 'SOS', ER: 'ERN',
  CD: 'CDF', GM: 'GMD', GN: 'GNF', SL: 'SLL', LR: 'LRD', CV: 'CVE',
  ST: 'STN', AO: 'AOA', NA: 'NAD', BW: 'BWP', ZM: 'ZMW', MW: 'MWK',
  MZ: 'MZN', LS: 'LSL', SZ: 'SZL', MG: 'MGA', KM: 'KMF', SC: 'SCR',
  MU: 'MUR',
  // Франк КФА BEAC (Центральная Африка)
  CM: 'XAF', CF: 'XAF', TD: 'XAF', CG: 'XAF', GQ: 'XAF', GA: 'XAF',
  // Франк КФА BCEAO (Западная Африка)
  BJ: 'XOF', BF: 'XOF', CI: 'XOF', GW: 'XOF', ML: 'XOF', NE: 'XOF',
  SN: 'XOF', TG: 'XOF',

  // Океания
  FJ: 'FJD', PG: 'PGK', SB: 'SBD', VU: 'VUV', WS: 'WST', TO: 'TOP',
  // Французский тихоокеанский франк
  NC: 'XPF', PF: 'XPF', WF: 'XPF',
}

// Маппинг country → IANA timezone (для маленьких стран — точно;
// для больших РФ/США/КА/АУ выбираем самую населённую зону как ориентир,
// потом фронт перепроверяет через браузерный Intl).
const COUNTRY_TO_TIMEZONE = {
  // СНГ
  RU: 'Europe/Moscow', UA: 'Europe/Kyiv', BY: 'Europe/Minsk',
  KZ: 'Asia/Almaty', KG: 'Asia/Bishkek', UZ: 'Asia/Tashkent',
  TJ: 'Asia/Dushanbe', TM: 'Asia/Ashgabat', MD: 'Europe/Chisinau',
  AM: 'Asia/Yerevan', GE: 'Asia/Tbilisi', AZ: 'Asia/Baku',

  // Северная Америка
  US: 'America/New_York', CA: 'America/Toronto', MX: 'America/Mexico_City',

  // Европа
  GB: 'Europe/London', IE: 'Europe/Dublin',
  FR: 'Europe/Paris', DE: 'Europe/Berlin', IT: 'Europe/Rome',
  ES: 'Europe/Madrid', PT: 'Europe/Lisbon', NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels', LU: 'Europe/Luxembourg', AT: 'Europe/Vienna',
  CH: 'Europe/Zurich', SE: 'Europe/Stockholm', NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', IS: 'Atlantic/Reykjavik',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SK: 'Europe/Bratislava',
  HU: 'Europe/Budapest', RO: 'Europe/Bucharest', BG: 'Europe/Sofia',
  GR: 'Europe/Athens', HR: 'Europe/Zagreb', SI: 'Europe/Ljubljana',
  RS: 'Europe/Belgrade', BA: 'Europe/Sarajevo', MK: 'Europe/Skopje',
  AL: 'Europe/Tirane', ME: 'Europe/Podgorica', XK: 'Europe/Belgrade',
  EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius',
  CY: 'Asia/Nicosia', MT: 'Europe/Malta',
  TR: 'Europe/Istanbul',

  // Ближний Восток
  IL: 'Asia/Jerusalem', AE: 'Asia/Dubai', SA: 'Asia/Riyadh',
  QA: 'Asia/Qatar', BH: 'Asia/Bahrain', KW: 'Asia/Kuwait',
  OM: 'Asia/Muscat', JO: 'Asia/Amman', LB: 'Asia/Beirut',
  SY: 'Asia/Damascus', IQ: 'Asia/Baghdad', IR: 'Asia/Tehran',
  YE: 'Asia/Aden',

  // Азия
  CN: 'Asia/Shanghai', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
  KP: 'Asia/Pyongyang', HK: 'Asia/Hong_Kong', TW: 'Asia/Taipei',
  SG: 'Asia/Singapore', MY: 'Asia/Kuala_Lumpur', TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh', ID: 'Asia/Jakarta', PH: 'Asia/Manila',
  IN: 'Asia/Kolkata', PK: 'Asia/Karachi', BD: 'Asia/Dhaka',
  LK: 'Asia/Colombo', NP: 'Asia/Kathmandu', AF: 'Asia/Kabul',
  MM: 'Asia/Yangon', KH: 'Asia/Phnom_Penh', LA: 'Asia/Vientiane',
  BN: 'Asia/Brunei', MN: 'Asia/Ulaanbaatar', BT: 'Asia/Thimphu',
  MO: 'Asia/Macau', MV: 'Indian/Maldives',

  // Африка
  ZA: 'Africa/Johannesburg', EG: 'Africa/Cairo', NG: 'Africa/Lagos',
  KE: 'Africa/Nairobi', GH: 'Africa/Accra', MA: 'Africa/Casablanca',
  TN: 'Africa/Tunis', DZ: 'Africa/Algiers', LY: 'Africa/Tripoli',

  // Океания
  AU: 'Australia/Sydney', NZ: 'Pacific/Auckland',
  FJ: 'Pacific/Fiji', PG: 'Pacific/Port_Moresby',

  // Латинская Америка
  BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires',
  CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima',
  UY: 'America/Montevideo', PY: 'America/Asuncion',
  BO: 'America/La_Paz', VE: 'America/Caracas',
  GT: 'America/Guatemala', HN: 'America/Tegucigalpa',
  NI: 'America/Managua', CR: 'America/Costa_Rica', PA: 'America/Panama',
  DO: 'America/Santo_Domingo', CU: 'America/Havana', HT: 'America/Port-au-Prince',
  JM: 'America/Jamaica', TT: 'America/Port_of_Spain',
  EC: 'America/Guayaquil', SV: 'America/El_Salvador',
}

/**
 * Получить геолокацию клиента из Cloudflare заголовков.
 * Возвращает { country, city, ip } или с null значениями если CF не определил.
 */
function getRawGeo(req) {
  const country = req.headers['cf-ipcountry']
  const city = req.headers['cf-ipcity']
  return {
    country: country && country !== 'XX' && country !== 'T1' ? country : null,
    city: city ? decodeURIComponent(city) : null,
    ip: req.headers['cf-connecting-ip'] ||
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        null,
  }
}

/**
 * Получить предлагаемую валюту по коду страны.
 * Если страны нет в маппинге → возвращаем USD.
 */
function getSuggestedCurrency(country) {
  if (!country) return 'USD'
  return COUNTRY_TO_CURRENCY[String(country).toUpperCase()] || 'USD'
}

/**
 * Получить предлагаемый часовой пояс по коду страны.
 * Если страны нет → возвращаем UTC.
 */
function getSuggestedTimezone(country) {
  if (!country) return 'UTC'
  return COUNTRY_TO_TIMEZONE[String(country).toUpperCase()] || 'UTC'
}

/**
 * Главный хелпер для публичных endpoint'ов.
 * Возвращает объект готовый для отправки на фронт:
 *   { country, city, currency, timezone }
 * Все поля могут быть null если Cloudflare не определил страну.
 */
function getClientGeo(req) {
  const { country, city } = getRawGeo(req)
  return {
    country,
    city,
    currency: country ? getSuggestedCurrency(country) : null,
    timezone: country ? getSuggestedTimezone(country) : null,
  }
}

module.exports = {
  getClientGeo,
  getRawGeo,
  getSuggestedCurrency,
  getSuggestedTimezone,
  COUNTRY_TO_CURRENCY,
  COUNTRY_TO_TIMEZONE,
}