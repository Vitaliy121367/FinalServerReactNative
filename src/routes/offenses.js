const express = require('express');

const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { uploadBase64 } = require('../cloudinary');

const router = express.Router();

// Часовий пояс для групування за днями (щоб запис о 00:30 за Києвом
// потрапляв у свій день, а не у попередній за UTC)
const TZ = process.env.TIMEZONE || 'Europe/Kyiv';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const SELECT_OFFENSE = `
    SELECT o.id, o.description, o.url, o.date, o.user_id,
           o.latitude, o.longitude, o.client_id,
           u.first_name, u.last_name
    FROM offenses o
    LEFT JOIN users u ON u.id = o.user_id
`;

// Перетворює рядок з БД у об'єкт для клієнта (camelCase)
const toOffense = (row) => ({
    id: row.id,
    description: row.description,
    url: row.url,
    date: row.date,
    userId: row.user_id,
    latitude: row.latitude,
    longitude: row.longitude,
    clientId: row.client_id,
    author: row.first_name ? `${row.first_name} ${row.last_name}` : null,
});

const getOffenseById = async (id) => {
    const { rows } = await pool.query(`${SELECT_OFFENSE} WHERE o.id = $1`, [id]);
    return rows[0] ? toOffense(rows[0]) : null;
};

// ---------------------------------------------------------------------------
// GET /offenses/days?month=2026-10
// Дні місяця, в які є правопорушення (для позначок у календарі)
// Відповідь: { days: ["2026-10-05", "2026-10-29"] }
// ---------------------------------------------------------------------------
router.get('/days', async (req, res) => {
    try {
        const { month } = req.query;

        if (!MONTH_REGEX.test(month || '')) {
            return res.status(400).json({ error: 'Параметр month має формат YYYY-MM' });
        }

        const { rows } = await pool.query(
            `SELECT DISTINCT to_char(date AT TIME ZONE $2, 'YYYY-MM-DD') AS day
             FROM offenses
             WHERE to_char(date AT TIME ZONE $2, 'YYYY-MM') = $1
             ORDER BY day`,
            [month, TZ]
        );

        return res.json({ days: rows.map((r) => r.day) });
    } catch (err) {
        console.error('Помилка GET /offenses/days:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ---------------------------------------------------------------------------
// GET /offenses/locations
// Унікальні точки для маркерів на мапі (координати округлено до 4 знаків,
// це приблизно 11 м, тож близькі правопорушення групуються в один маркер)
// Відповідь: { locations: [{ latitude, longitude, count }] }
// ---------------------------------------------------------------------------
router.get('/locations', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT ROUND(latitude::numeric, 4)::float8  AS latitude,
                    ROUND(longitude::numeric, 4)::float8 AS longitude,
                    COUNT(*)::int AS count
             FROM offenses
             WHERE latitude IS NOT NULL AND longitude IS NOT NULL
             GROUP BY 1, 2`
        );

        return res.json({ locations: rows });
    } catch (err) {
        console.error('Помилка GET /offenses/locations:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ---------------------------------------------------------------------------
// GET /offenses/by-location?lat=50.0001&lng=36.2304
// Правопорушення в точці (збіг по координатах, округлених до 4 знаків,
// так само як у /locations)
// Відповідь: { offenses: [...] }
// ---------------------------------------------------------------------------
router.get('/by-location', async (req, res) => {
    try {
        const lat = Number(req.query.lat);
        const lng = Number(req.query.lng);

        if (
            !Number.isFinite(lat) || !Number.isFinite(lng) ||
            Math.abs(lat) > 90 || Math.abs(lng) > 180
        ) {
            return res.status(400).json({ error: 'Некоректні параметри lat/lng' });
        }

        const { rows } = await pool.query(
            `${SELECT_OFFENSE}
             WHERE ROUND(o.latitude::numeric, 4)  = ROUND($1::numeric, 4)
               AND ROUND(o.longitude::numeric, 4) = ROUND($2::numeric, 4)
             ORDER BY o.date DESC
             LIMIT 200`,
            [lat, lng]
        );

        return res.json({ offenses: rows.map(toOffense) });
    } catch (err) {
        console.error('Помилка GET /offenses/by-location:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ---------------------------------------------------------------------------
// GET /offenses?date=2026-10-29
// Правопорушення за конкретну дату
// Відповідь: { offenses: [...] }
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
    try {
        const { date } = req.query;

        if (!DATE_REGEX.test(date || '')) {
            return res.status(400).json({ error: 'Параметр date має формат YYYY-MM-DD' });
        }

        const { rows } = await pool.query(
            `${SELECT_OFFENSE}
             WHERE to_char(o.date AT TIME ZONE $2, 'YYYY-MM-DD') = $1
             ORDER BY o.date DESC
             LIMIT 200`,
            [date, TZ]
        );

        return res.json({ offenses: rows.map(toOffense) });
    } catch (err) {
        console.error('Помилка GET /offenses:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ---------------------------------------------------------------------------
// GET /offenses/:id
// Одне правопорушення (для екрана деталей)
// Відповідь: { offense }
// Цей маршрут має бути ПІСЛЯ /days, /locations, /by-location
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Некоректний id' });
        }

        const offense = await getOffenseById(id);

        if (!offense) {
            return res.status(404).json({ error: 'Правопорушення не знайдено' });
        }

        return res.json({ offense });
    } catch (err) {
        console.error('Помилка GET /offenses/:id:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

// ---------------------------------------------------------------------------
// POST /offenses  (потрібен токен)
// Тіло: { description, date, latitude, longitude, imageBase64, clientId }
// Відповідь: 201 { offense } для нового запису,
//            200 { offense }, якщо запис з таким clientId уже є
//            (повторна відправка під час синхронізації не створює дублікат)
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { description, date, latitude, longitude, imageBase64, clientId } = req.body;

        // Валідація
        if (!description?.trim()) {
            return res.status(400).json({ error: 'Додайте опис правопорушення' });
        }
        if (description.trim().length > 1000) {
            return res.status(400).json({ error: 'Опис занадто довгий (максимум 1000 символів)' });
        }

        const parsedDate = new Date(date);
        if (!date || Number.isNaN(parsedDate.getTime())) {
            return res.status(400).json({ error: 'Некоректна дата' });
        }

        const lat = Number(latitude);
        const lng = Number(longitude);
        if (
            latitude == null || longitude == null ||
            !Number.isFinite(lat) || !Number.isFinite(lng) ||
            Math.abs(lat) > 90 || Math.abs(lng) > 180
        ) {
            return res.status(400).json({ error: 'Некоректна геолокація' });
        }

        if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
            return res.status(400).json({ error: 'Додайте фото правопорушення' });
        }

        if (typeof clientId !== 'string' || !clientId.trim()) {
            return res.status(400).json({ error: 'Відсутній clientId' });
        }

        // Ідемпотентність: якщо запис уже є, повертаємо його без повторного завантаження фото
        const existing = await pool.query(
            'SELECT id, user_id FROM offenses WHERE client_id = $1',
            [clientId]
        );

        if (existing.rows[0]) {
            if (existing.rows[0].user_id !== req.user.id) {
                return res.status(409).json({ error: 'Конфлікт clientId' });
            }
            const offense = await getOffenseById(existing.rows[0].id);
            return res.status(200).json({ offense });
        }

        // Фото завантажується в Cloudinary, в базі зберігається лише посилання
        let url;
        try {
            url = await uploadBase64(imageBase64);
        } catch (uploadError) {
            console.error('Помилка Cloudinary:', uploadError);
            return res.status(502).json({ error: 'Не вдалося завантажити фото' });
        }

        // ON CONFLICT захищає від гонки: два однакові запити одночасно
        const inserted = await pool.query(
            `INSERT INTO offenses (description, url, date, user_id, latitude, longitude, client_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (client_id) DO NOTHING
             RETURNING id`,
            [description.trim(), url, parsedDate.toISOString(), req.user.id, lat, lng, clientId]
        );

        if (inserted.rows.length === 0) {
            const again = await pool.query(
                'SELECT id FROM offenses WHERE client_id = $1',
                [clientId]
            );
            const offense = await getOffenseById(again.rows[0].id);
            return res.status(200).json({ offense });
        }

        const offense = await getOffenseById(inserted.rows[0].id);
        return res.status(201).json({ offense });
    } catch (err) {
        console.error('Помилка POST /offenses:', err);
        return res.status(500).json({ error: 'Помилка сервера' });
    }
});

module.exports = router;