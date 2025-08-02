import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Создаем таблицу для токенов
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        chat_id BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('Auth tokens table created or exists');
    
    // Автоматическое удаление старых токенов
    await pool.query(`
      CREATE OR REPLACE FUNCTION delete_old_tokens()
      RETURNS TRIGGER AS $$
      BEGIN
        DELETE FROM auth_tokens WHERE created_at < NOW() - INTERVAL '10 minutes';
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS tokens_cleanup_trigger ON auth_tokens;
      CREATE TRIGGER tokens_cleanup_trigger
      AFTER INSERT ON auth_tokens
      EXECUTE FUNCTION delete_old_tokens();
    `);
    console.log('Created automatic token cleanup trigger');
  } catch (err) {
    console.error('Error setting up database:', err);
  }
})();

// Настройка Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 неделя
  }
}));

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.static(join(__dirname, 'public')));

// Telegram Bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'user';
  
  try {
    const token = crypto.randomBytes(20).toString('hex');
    
    // Сохраняем токен в PostgreSQL
    await pool.query(
      'INSERT INTO auth_tokens (token, username, chat_id) VALUES ($1, $2, $3)',
      [token, username, chatId]
    );
    
    // Формирование ссылки
    let baseUrl = process.env.SERVER_URL;
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const loginLink = `${baseUrl}login?token=${token}`;
    
    // Отправка красивого сообщения
    bot.sendMessage(chatId, `
🔑 <b>Ваша ссылка для входа</b>

✨ Используйте эту ссылку для входа в систему:
${loginLink}

⌛ Ссылка действительна 10 минут
    `, { parse_mode: 'HTML' });
    
    console.log(`Token generated for @${username}: ${token}`);
  } catch (error) {
    console.error('Ошибка генерации токена:', error);
    bot.sendMessage(chatId, '⚠️ <b>Ошибка генерации ссылки</b>\nПопробуйте позже', { parse_mode: 'HTML' });
  }
});

// Маршруты
app.get('/', (req, res) => {
  res.render('index', { 
    botUsername: process.env.BOT_USERNAME,
    session: req.session 
  });
});

app.get('/login', async (req, res) => {
  let { token } = req.query;
  
  if (!token) {
    return res.status(401).render('error', { 
      message: 'Токен не предоставлен',
      session: req.session 
    });
  }
  
  // Декодируем токен
  token = decodeURIComponent(token);
  console.log(`Login attempt with token: ${token}`);
  
  try {
    // Проверяем токен в базе данных
    const result = await pool.query(
      `DELETE FROM auth_tokens 
       WHERE token = $1 
       AND created_at > NOW() - INTERVAL '10 minutes'
       RETURNING username, chat_id`,
      [token]
    );
    
    if (result.rows.length === 0) {
      console.log('Invalid or expired token');
      return res.status(401).render('error', { 
        message: 'Недействительный или просроченный токен',
        session: req.session 
      });
    }
    
    const userData = result.rows[0];
    
    // Устанавливаем сессию
    req.session.authenticated = true;
    req.session.username = userData.username;
    
    console.log(`User authenticated: @${userData.username}`);
    
    // Перенаправляем в профиль
    return res.redirect('/profile');
  } catch (error) {
    console.error('Ошибка аутентификации:', error);
    res.status(500).render('error', { 
      message: 'Внутренняя ошибка сервера',
      session: req.session 
    });
  }
});

app.get('/profile', (req, res) => {
  if (req.session.authenticated) {
    return res.render('profile', { 
      username: req.session.username,
      session: req.session 
    });
  }
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.redirect('/');
  });
});

// Для отладки: просмотр всех токенов
app.get('/debug-tokens', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM auth_tokens');
    res.json({
      count: result.rows.length,
      tokens: result.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, async () => {
  console.log(`Сервер запущен на порту ${port}`);
  console.log(`Режим: ${process.env.NODE_ENV || 'development'}`);
  console.log(`SERVER_URL: ${process.env.SERVER_URL}`);
  
  // Проверка подключения к БД
  try {
    await pool.query('SELECT NOW()');
    console.log('PostgreSQL connected successfully');
    
    // Проверка таблицы токенов
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'auth_tokens'
      )
    `);
    console.log('Auth tokens table exists:', tableCheck.rows[0].exists);
  } catch (err) {
    console.error('PostgreSQL connection error:', err);
  }
});
