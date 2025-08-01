const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.BOT_TOKEN;
const SERVER_URL = process.env.SERVER_URL;

const bot = new TelegramBot(TOKEN, {polling: true});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  
  try {
    const response = await axios.post(`${SERVER_URL}/api/tokens`, {
      username,
      chatId
    });
    
    const loginLink = `${SERVER_URL}/login?token=${response.data.token}`;
    bot.sendMessage(chatId, `🔑 Ваша персональная ссылка для входа: ${loginLink}`);
  } catch (error) {
    console.error('Ошибка генерации токена:', error);
    bot.sendMessage(chatId, '⚠️ Ошибка генерации ссылки. Попробуйте позже.');
  }
});
