// Транслитерация русского текста в латиницу + slug-формат
const TRANSLIT = {
  'а':'a', 'б':'b', 'в':'v', 'г':'g', 'д':'d', 'е':'e', 'ё':'yo',
  'ж':'zh', 'з':'z', 'и':'i', 'й':'y', 'к':'k', 'л':'l', 'м':'m',
  'н':'n', 'о':'o', 'п':'p', 'р':'r', 'с':'s', 'т':'t', 'у':'u',
  'ф':'f', 'х':'h', 'ц':'c', 'ч':'ch', 'ш':'sh', 'щ':'sch', 'ъ':'',
  'ы':'y', 'ь':'', 'э':'e', 'ю':'yu', 'я':'ya'
}

// Превращает любую строку в slug: "Первичная Консультация 30!" → "pervichnaya-konsultaciya-30"
function makeSlug(text) {
  if (!text) return ''
  return text
    .toLowerCase()
    .split('')
    .map(c => TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')  // всё что не латиница/цифры → дефис
    .replace(/^-+|-+$/g, '')       // убираем дефисы по краям
    .substring(0, 100)             // макс 100 символов
}

// Делает slug уникальным в рамках пользователя
// Если slug "trenirovka" уже занят — пробует "trenirovka-2", "trenirovka-3", ...
async function makeUniqueSlug(pool, userId, baseSlug, excludeId = null) {
  if (!baseSlug) baseSlug = 'service'  // на случай если из title не получился slug (например, эмодзи)

  let candidate = baseSlug
  let counter = 2

  while (true) {
    const query = excludeId
      ? 'SELECT id FROM meeting_types WHERE user_id = $1 AND slug = $2 AND id != $3'
      : 'SELECT id FROM meeting_types WHERE user_id = $1 AND slug = $2'
    const params = excludeId ? [userId, candidate, excludeId] : [userId, candidate]
    const result = await pool.query(query, params)

    if (result.rows.length === 0) return candidate

    candidate = `${baseSlug}-${counter}`
    counter++

    if (counter > 1000) throw new Error('Cannot generate unique slug')
  }
}

module.exports = { makeSlug, makeUniqueSlug }