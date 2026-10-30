require('dotenv').config();
const cloudinary = require('cloudinary').v2;

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

const isConfigured = Boolean(
    CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET
);

if (!isConfigured) {
    // Сервер працює й без Cloudinary, але створення правопорушень з фото буде недоступне
    console.warn('Увага: не задано CLOUDINARY_* у файлі .env, завантаження фото не працюватиме');
}

cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
});

// Завантажує фото (base64 з префіксом data: або без нього) і повертає https-посилання
const uploadBase64 = async (base64, folder = 'offenses') => {
    if (!isConfigured) {
        throw new Error('Cloudinary не налаштовано');
    }

    const dataUri = base64.startsWith('data:')
        ? base64
        : `data:image/jpeg;base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
        folder,
        resource_type: 'image',
    });

    return result.secure_url;
};

module.exports = { uploadBase64 };