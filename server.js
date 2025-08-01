require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const app = express();
const port = process.env.PORT || 3000;

// --- Конфигурация Express ---
const __dirname = path.resolve();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Генерация секрета для сессий
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

// --- Хранилище токенов (временное) ---
const tokensStorage = new Map();

// --- Telegram Bot ---
const bot = new TelegramBot(process.env.BOT_TOKEN, {polling: true});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  
  try {
    // Генерация токена
    const token = crypto.randomBytes(20).toString('hex');
    tokensStorage.set(token, { username, chatId });
    
    // Очистка токена через 10 минут
    setTimeout(() => {
      if (tokensStorage.has(token)) tokensStorage.delete(token);
    }, 600000);
    
    // Отправка ссылки пользователю
    const loginLink = `${process.env.SERVER_URL}/login?token=${token}`;
    bot.sendMessage(chatId, `🔑 Ваша персональная ссылка для входа: ${loginLink}\n\nСсылка действительна 10 минут`);
  } catch (error) {
    console.error('Ошибка генерации токена:', error);
    bot.sendMessage(chatId, '⚠️ Ошибка генерации ссылки. Попробуйте позже.');
  }
});

// --- Маршруты Express ---

// Главная страница
app.get('/', (req, res) => {
  res.render('index');
});

// Аутентификация
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

// Профиль пользователя
app.get('/profile', (req, res) => {
  if (req.session.authenticated) {
    return res.render('profile', { 
      username: req.session.username 
    });
  }
  res.redirect('/');
});

// Выход
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.redirect('/');
  });
});

// --- Запуск сервера ---
app.listen(port, () => {
  console.log(`Сервер и Telegram бот запущены на порту ${port}`);
  console.log(`Режим: ${process.env.NODE_ENV || 'development'}`);
  
  // Для отладки
  console.log('Директория views:', path.join(__dirname, 'views'));
  console.log('Директория public:', path.join(__dirname, 'public'));
});
