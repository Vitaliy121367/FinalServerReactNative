const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Перетворює рядок з БД у об'єкт для клієнта (camelCase, без пароля)
const toPublicUser = (row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
});

// POST /auth/register
// Тіло: { firstName, lastName, email, password }
router.post('/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;

        // Валідація вхідних даних
        if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password) {
            return res.status(400).json({ error: 'Заповніть усі поля' });
        }

        if (!EMAIL_REGEX.test(email.trim())) {
            return res.status(400).json({ error: 'Некоректний email' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль має містити щонайменше 6 символів' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Перевіряємо, чи email уже зайнятий
        const existing = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [normalizedEmail]
        );

        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Користувач з таким email уже існує' });
        }

        // Пароль у базі зберігається лише у вигляді хешу
        const passwordHash = await bcrypt.hash(password, 10);

        const { rows } = await pool.query(
            `INSERT INTO users (first_name, last_name, email, password)
             VALUES ($1, $2, $3, $4)
             RETURNING id, first_name, last_name, email`,
            [firstName.trim(), lastName.trim(), normalizedEmail, passwordHash]
        );

        return res.status(201).json({ user: toPublicUser(rows[0]) });
    } catch (err) {
        // 23505 — порушення унікальності (два запити з однаковим email одночасно)
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Користувач з таким email уже існує' });
        }
        console.error('Помилка реєстрації:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// POST /auth/login
// Тіло: { email, password }
// Відповідь: { token, user }
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email?.trim() || !password) {
            return res.status(400).json({ error: 'Введіть email та пароль' });
        }

        const { rows } = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email.trim().toLowerCase()]
        );

        const user = rows[0];

        // Однакове повідомлення для неіснуючого email і хибного пароля,
        // щоб не підказувати, які email зареєстровані
        if (!user) {
            return res.status(401).json({ error: 'Невірний email або пароль' });
        }

        const passwordOk = await bcrypt.compare(password, user.password);

        if (!passwordOk) {
            return res.status(401).json({ error: 'Невірний email або пароль' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.json({ token, user: toPublicUser(user) });
    } catch (err) {
        console.error('Помилка входу:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// GET /auth/me — захищений маршрут, зручний для перевірки токена в Postman
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, first_name, last_name, email FROM users WHERE id = $1',
            [req.user.id]
        );

        if (!rows[0]) {
            return res.status(404).json({ error: 'Користувача не знайдено' });
        }

        return res.json({ user: toPublicUser(rows[0]) });
    } catch (err) {
        console.error('Помилка /auth/me:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

module.exports = router;