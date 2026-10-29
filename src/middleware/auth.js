const jwt = require('jsonwebtoken');

// Перевіряє заголовок Authorization: Bearer <token>
// Якщо токен валідний — кладе дані користувача в req.user
module.exports = (req, res, next) => {
    const header = req.headers.authorization || '';
    const [type, token] = header.split(' ');

    if (type !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Потрібна авторизація' });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = { id: payload.id, email: payload.email };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Недійсний або прострочений токен' });
    }
};