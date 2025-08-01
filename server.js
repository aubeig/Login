import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { Pool } from 'pg';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const PgStore = pgSession(session);
const sessionStore = new PgStore({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true
});

// Создаем таблицу для токенов
pool.query(`
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    chat_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );
`).catch(err => console.error('Error creating tokens table:', err));

// Настройка Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: sessionStore,
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
  const { token } = req.query;
  
  if (!token) {
    return res.status(401).render('error', { 
      message: 'Токен не предоставлен',
      session: req.session 
    });
  }
  
  try {
    // Проверяем токен в базе данных
    const result = await pool.query(
      `DELETE FROM auth_tokens 
       WHERE token = $1 
       RETURNING username, chat_id, created_at`,
      [token]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).render('error', { 
        message: 'Недействительный или просроченный токен',
        session: req.session 
      });
    }
    
    const userData = result.rows[0];
    const tokenAge = (Date.now() - new Date(userData.created_at).getTime()) / 60000;
    
    if (tokenAge > 10) {
      return res.status(401).render('error', { 
        message: 'Токен просрочен',
        session: req.session 
      });
    }
    
    // Устанавливаем сессию
    req.session.authenticated = true;
    req.session.username = userData.username;
    
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

app.listen(port, async () => {
  console.log(`Сервер запущен на порту ${port}`);
  console.log(`Режим: ${process.env.NODE_ENV || 'development'}`);
  console.log(`SERVER_URL: ${process.env.SERVER_URL}`);
  
  // Проверка подключения к БД
  try {
    await pool.query('SELECT NOW()');
    console.log('PostgreSQL connected successfully');
  } catch (err) {
    console.error('PostgreSQL connection error:', err);
  }
});
