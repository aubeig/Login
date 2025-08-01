require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 3000;

// Генерация секрета для сессий
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.set('view engine', 'ejs');
app.use(express.static('public'));

// Хранилище токенов (в продакшене замените на Redis)
const tokensStorage = new Map();

// API для сохранения токенов
app.post('/api/tokens', (req, res) => {
  const { username, chatId } = req.body;
  const token = crypto.randomBytes(20).toString('hex');
  
  tokensStorage.set(token, { username, chatId });
  
  // Очистка токена через 10 минут
  setTimeout(() => tokensStorage.delete(token), 600000);
  
  res.json({ token });
});

// Маршрут аутентификации
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

// Выход из системы
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.redirect('/');
  });
});

// Главная страница
app.get('/', (req, res) => {
  res.render('index');
});

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});
