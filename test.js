import crypto from 'crypto';

function validateTelegramWebApp(initData, botToken) {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    console.log("hash from initData:", hash);

    console.log(urlParams);

    // Сортируем параметры по ключу
    const dataCheckString = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    console.log(dataCheckString);

    // Создаём секретный ключ
    const secretKey = crypto
        .createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();

    // Вычисляем хеш
    const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

    return calculatedHash === hash;
}

console.log(validateTelegramWebApp(
    "query_id=AAGMdEo5AAAAAIx0Sjmnpeez&user=%7B%22id%22%3A961180812%2C%22first_name%22%3A%22%D0%AF%D0%BD%22%2C%22last_name%22%3A%22%22%2C%22username%22%3A%22kukuruzity2004%22%2C%22language_code%22%3A%22ru%22%2C%22allows_write_to_pm%22%3Atrue%2C%22photo_url%22%3A%22https%3A%5C%2F%5C%2Ft.me%5C%2Fi%5C%2Fuserpic%5C%2F320%5C%2F3hjR49-UtCvB4-1fVwqUKt0L2i-ie2cVMGtbgXVdwY0.svg%22%7D&auth_date=1764251972&signature=qH6KrHEILLDfrueSxDnphVb1iDZK2GmTRtrfK3e-pil0jUDqFRyk86rDNEgbT4mADbMRxvfkZ8JRV9DyMxf5Cw&hash=a65750a6d808cda9ece2011778edf16445af57656cabdece61469d473cbdb539",
    "8259899753:AAF2tOI2mOyuFzw6kL7c1Y51hL_BpQOg2qE"))