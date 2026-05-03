require('dotenv').config()
const pool = require('./db')

async function migrate() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        bio TEXT,
        avatar VARCHAR(255),
        telegram_chat_id VARCHAR(255),
        telegram_token VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(255)`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_token VARCHAR(255)`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_types (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        duration INTEGER NOT NULL,
        price INTEGER DEFAULT 0,
        currency VARCHAR(10) DEFAULT 'RUB',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        meeting_type_id INTEGER REFERENCES meeting_types(id) ON DELETE CASCADE,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255) NOT NULL,
        client_phone VARCHAR(50),
        notes TEXT,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        video_link VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL,
        start_time VARCHAR(5) NOT NULL,
        end_time VARCHAR(5) NOT NULL,
        is_active BOOLEAN DEFAULT true
      )
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_overrides (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        is_available BOOLEAN DEFAULT false,
        reason VARCHAR(255)
      )
    `)

    console.log('Все таблицы созданы!')
    process.exit(0)
  } catch (err) {
    console.error('Ошибка:', err)
    process.exit(1)
  }
}

migrate()