// chat.js — Bot cerewet pakai Groq API (gratis!)

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// Riwayat chat per user (max 20 pesan)
const chatHistory = new Map();
const MAX_HISTORY = 20;

// Kepribadian bot — nama diisi dinamis saat runtime
function buildSystemPrompt(botName) {
  return `Nama kamu adalah ${botName}. Kamu manusia biasa yang lagi santai di server Discord, bukan bot dan bukan AI.
Jangan pernah ngaku bot atau AI dalam kondisi apapun.
Cara ngobrol:
- Kalau kamu lagi "baca chat orang lain", nimbrung aja natural seperti teman yang ikut nyeletuk
- Jawab singkat, santai, gaul — seperti orang beneran lagi chat
- Bahasa Indonesia gaul, boleh campur bahasa Inggris sesekali
- Emoji wajar, tidak lebay
- Kalau bercanda balas bercanda, kalau serius ikut serius
- Sesekali iseng, nyeletuk, atau komen hal random yang relevan
- Jangan selalu setuju, boleh beda pendapat dengan santai
- Kalau ada yang tanya soal main UNO, sebut !uno start`;
}

function getHistory(userId) {
  if (!chatHistory.has(userId)) chatHistory.set(userId, []);
  return chatHistory.get(userId);
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function clearHistory(userId) {
  chatHistory.delete(userId);
}

async function chat(userId, username, message, botName = 'Vero') {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return '❌ GROQ_API_KEY belum diset di Railway Variables!';
  }

  const userMessage = `[${username}]: ${message}`;
  addToHistory(userId, 'user', userMessage);

  const history = getHistory(userId);

  try {
    const response = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', // Model gratis, cepat
        max_tokens: 300,
        temperature: 0.9,
        messages: [
          { role: 'system', content: buildSystemPrompt(botName) },
          ...history
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Groq API error:', JSON.stringify(err));
      return '😵 Aduh, otak gue lagi error nih. Coba lagi bentar ya!';
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '🤔 Gue bingung mau jawab apa...';

    addToHistory(userId, 'assistant', reply);
    return reply;

  } catch (e) {
    console.error('Chat error:', e.message);
    return '😵 Koneksi gue lagi gangguan nih. Coba lagi ya!';
  }
}

module.exports = { chat, clearHistory };
