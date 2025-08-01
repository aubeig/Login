import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';

// Получаем __dirname для ES-модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Конфигурация путей
const viewsPath = join(__dirname, 'views');
const publicPath = join(__dirname, 'public');

// Проверка существования директорий
console.log(`Project root: ${__dirname}`);
console.log(`Views path: ${viewsPath}`);
console.log(`Public path: ${publicPath}`);

// Настройка сессий
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Настройка шаблонов и статических файлов
app.set('view engine', 'ejs');
app.set('views', viewsPath);
app.use(express.static(publicPath));

// Хранилище токенов
const tokensStorage = new Map();

// Telegram Bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  
  try {
    const token = crypto.randomBytes(20).toString('hex');
    tokensStorage.set(token, { username, chatId });
    
    setTimeout(() => {
      if (tokensStorage.has(token)) tokensStorage.delete(token);
    }, 600000);
    
    // Исправление двойного слеша в URL
    let baseUrl = process.env.SERVER_URL;
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const loginLink = `${baseUrl}login?token=${token}`;
    
    bot.sendMessage(chatId, `🔑 Ваша персональная ссылка для входа: ${loginLink}\n\nСсылка действительна 10 минут`);
  } catch (error) {
    console.error('Ошибка генерации токена:', error);
    bot.sendMessage(chatId, '⚠️ Ошибка генерации ссылки. Попробуйте позже.');
  }
});

// Маршруты
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/login', (req, res) => {
  const { token } = req.query;
  
  if (token && tokensStorage.has(token)) {
    const userData = tokensStorage.get(token);
    tokensStorage.delete(token);
    
    req.session.authenticated = true;
    req.session.username = userData.username;
    return res.redirect('/profile');
  }
  
  res.status(401).render('error', { message: 'Недействительный или просроченный токен' });
});

app.get('/profile', (req, res) => {
  if (req.session.authenticated) {
    return res.render('profile', { 
      username: req.session.username 
    });
  }
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.redirect('/');
  });
});

// Обработка 404
app.use((req, res) => {
  res.status(404).render('error', { message: 'Страница не найдена' });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { message: 'Внутренняя ошибка сервера' });
});

app.listen(port, () => {
  console.log(`Сервер и бот запущены на порту ${port}`);
  console.log(`Режим: ${process.env.NODE_ENV || 'development'}`);
  console.log(`SERVER_URL: ${process.env.SERVER_URL}`);
});
