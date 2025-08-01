import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';

// Получаем абсолютные пути
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// 1. Гарантируем существование всех директорий
const requiredDirs = [
  join(__dirname, 'views'),
  join(__dirname, 'public'),
  join(__dirname, 'public', 'css')
];

requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// 2. Создаем обязательные файлы, если они отсутствуют
const createFileIfMissing = (path, content) => {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, content);
    console.log(`Created file: ${path}`);
  }
};

// Файлы и их содержимое
const filesToCreate = {
  [join(__dirname, 'views', 'index.ejs')]: `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telegram Auth</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div class="container">
    <h1>Telegram Авторизация</h1>
    <p>Для входа получите ссылку в Telegram боте</p>
    <p>Бот: @<%= process.env.BOT_USERNAME || 'ваш_бот' %></p>
  </div>
</body>
</html>`,
  
  [join(__dirname, 'views', 'profile.ejs')]: `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Профиль</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div class="container">
    <h1>Ваш профиль</h1>
    <p>Добро пожаловать, @<%= username %>!</p>
    <a href="/logout">Выйти</a>
  </div>
</body>
</html>`,
  
  [join(__dirname, 'views', 'error.ejs')]: `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ошибка</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div class="container">
    <h1>Ошибка</h1>
    <p><%= message %></p>
    <a href="/">На главную</a>
  </div>
</body>
</html>`,
  
  [join(__dirname, 'public', 'css', 'style.css')]: `:root {
  --dark-bg: #121212;
  --card-bg: #1e1e1e;
  --accent: #6a0dad;
  --text: #e0d6eb;
}

body {
  background: var(--dark-bg);
  color: var(--text);
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  margin: 0;
  padding: 20px;
}

.container {
  background: var(--card-bg);
  border-radius: 10px;
  padding: 30px;
  max-width: 800px;
  margin: 40px auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

h1 {
  color: #b19cd9;
  margin-top: 0;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}`
};

// Создаем все файлы
Object.entries(filesToCreate).forEach(([path, content]) => {
  createFileIfMissing(path, content);
});

// 3. Настройка Express
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.static(join(__dirname, 'public')));

// 4. Хранилище токенов
const tokensStorage = new Map();

// 5. Telegram Bot - безопасная инициализация
let bot = null;

const initBot = () => {
  try {
    bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from.username;
      
      try {
        const token = crypto.randomBytes(20).toString('hex');
        tokensStorage.set(token, { username, chatId });
        
        setTimeout(() => {
          if (tokensStorage.has(token)) tokensStorage.delete(token);
        }, 600000);
        
        let baseUrl = process.env.SERVER_URL;
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const loginLink = `${baseUrl}login?token=${token}`;
        
        bot.sendMessage(chatId, `🔑 Ваша ссылка для входа: ${loginLink}`);
      } catch (error) {
        console.error('Ошибка генерации токена:', error);
        bot.sendMessage(chatId, '⚠️ Ошибка генерации ссылки. Попробуйте позже.');
      }
    });
    
    console.log('Telegram bot initialized successfully');
    return true;
  } catch (error) {
    console.error('Bot initialization failed:', error);
    return false;
  }
};

// Пытаемся инициализировать бота с повторными попытками
const initBotWithRetry = (attempt = 1, maxAttempts = 5) => {
  if (attempt > maxAttempts) {
    console.error('Failed to initialize bot after multiple attempts');
    return;
  }
  
  console.log(`Initializing bot (attempt ${attempt}/${maxAttempts})...`);
  
  if (initBot()) {
    console.log('Bot initialized successfully');
  } else {
    console.log(`Retrying in ${attempt * 2} seconds...`);
    setTimeout(() => initBotWithRetry(attempt + 1, maxAttempts), attempt * 2000);
  }
};

// Запускаем инициализацию бота с задержкой
setTimeout(() => initBotWithRetry(), 3000);

// 6. Маршруты
app.get('/', (req, res) => {
  // Передаем имя бота в шаблон
  res.render('index', { 
    process: {
      env: {
        BOT_USERNAME: process.env.BOT_USERNAME
      }
    }
  });
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

// 7. Обработка ошибок
app.use((req, res) => {
  res.status(404).render('error', { message: 'Страница не найдена' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { message: 'Внутренняя ошибка сервера' });
});

// 8. Запуск сервера
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
  console.log(`Режим: ${process.env.NODE_ENV || 'development'}`);
  console.log(`SERVER_URL: ${process.env.SERVER_URL}`);
  
  // Выводим список файлов для диагностики
  console.log('\nДиректория views:');
  fs.readdirSync(join(__dirname, 'views')).forEach(file => {
    console.log(`- ${file}`);
  });
  
  console.log('\nДиректория public/css:');
  fs.readdirSync(join(__dirname, 'public', 'css')).forEach(file => {
    console.log(`- ${file}`);
  });
  
  console.log('\nГотов к работе!');
});
