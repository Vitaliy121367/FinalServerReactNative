require('dotenv').config();

const express = require('express');
const cors = require('cors');

const pool = require('./db');
const authRoutes = require('./routes/auth');

// Без секрету JWT сервер не має сенсу запускати
if (!process.env.JWT_SECRET) {
    console.error('Не задано JWT_SECRET у файлі .env');
    process.exit(1);
}

const app = express();

app.use(cors());

// Великий ліміт потрібен для фото в base64 (використаємо пізніше в POST /offenses)
app.use(express.json({ limit: '10mb' }));

// Перевірка, що сервер і база працюють: відкрий http://localhost:3000/health
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'error', db: 'disconnected' });
    }
});

app.use('/auth', authRoutes);

// Невідомий маршрут
app.use((req, res) => {
    res.status(404).json({ error: 'Маршрут не знайдено' });
});

// Глобальний обробник помилок (наприклад, некоректний JSON у тілі запиту)
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: 'Помилка сервера' });
});

const PORT = process.env.PORT || 3000;

// 0.0.0.0 — щоб сервер був доступний з телефона по IP комп'ютера в Wi-Fi мережі
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущено на порту ${PORT}`);
});