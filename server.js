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

// Проверка существования критически важных директорий
const requiredDirs = [
  join(__dirname, 'views'),
  join(__dirname, 'public'),
  join(__dirname, 'public', 'css')
];

requiredDirs.forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  } catch (err) {
    console.error(`Error creating directory ${dir}:`, err);
  }
});

// Создаем файл error.ejs, если он отсутствует
const errorEjsPath = join(__dirname, 'views', 'error.ejs');
if (!fs.existsSync(errorEjsPath)) {
  const errorEjsContent = `<!DOCTYPE html>
<html>
<head>
  <title>Ошибка</title>
  <style>
    body { background: #121212; color: #e0d6eb; font-family: sans-serif; text-align: center; padding: 50px; }
    h1 { color: #ff5555; }
    p { max-width: 600px; margin: 20px auto; }
  </style>
</head>
<body>
  <h1>Ошибка</h1>
  <p><%= message %></p>
  <a href="/">Вернуться на главную</a>
</body>
</html>`;
  
  fs.writeFileSync(errorEjsPath, errorEjsContent);
  console.log('Created default error.ejs file');
}

// Создаем файл style.css, если он отсутствует
const styleCssPath = join(__dirname, 'public', 'css', 'style.css');
if (!fs.existsSync(styleCssPath)) {
  const styleCssContent = `body {
    background: #121212;
    color: #e0d6eb;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    margin: 0;
    padding: 20px;
  }
  
  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
  }`;
  
  fs.writeFileSync(styleCssPath, styleCssContent);
  console.log('Created default style.css file');
}

// Настройка Express
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(express.static(join(__dirname, 'public')));

// Хранилище токенов
const tokensStorage = new Map();

// Telegram Bot - используем polling с защитой от дублирования
let botInstance = null;

const initBot = () => {
  if (!botInstance) {
    botInstance = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
    
    botInstance.onText(/\/start/, (msg) => {
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
        
        botInstance.sendMessage(chatId, `🔑 Ваша ссылка для входа: ${loginLink}`);
      } catch (error) {
        console.error('Ошибка генерации токена:', error);
        botInstance.sendMessage(chatId, '⚠️ Ошибка генерации ссылки. Попробуйте позже.');
      }
    });
    
    console.log('Telegram bot initialized');
  }
  return botInstance;
};

// Инициализируем бота после небольшой задержки
setTimeout(initBot, 5000);

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

// Упрощенные обработчики ошибок
app.use((req, res) => {
  res.status(404).render('error', { message: 'Страница не найдена' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { message: 'Внутренняя ошибка сервера' });
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
  console.log(`Режим: ${process.env.NODE_ENV || 'development'}`);
  console.log(`SERVER_URL: ${process.env.SERVER_URL}`);
  console.log('Проверка файлов:');
  console.log('Views:', fs.readdirSync(join(__dirname, 'views')));
  console.log('Public:', fs.readdirSync(join(__dirname, 'public')));
  console.log('Public/css:', fs.readdirSync(join(__dirname, 'public', 'css')));
});
