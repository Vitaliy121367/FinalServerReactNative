require('dotenv').config();
const { Pool } = require('pg');

// Один спільний пул підключень до PostgreSQL на весь сервер
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Помилки неактивних підключень не повинні валити сервер
pool.on('error', (err) => {
    console.error('Неочікувана помилка пулу PostgreSQL:', err);
});

module.exports = pool;