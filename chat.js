// chat.js — Bot cerewet pakai Groq API (gratis!)

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// Riwayat chat per user (max 20 pesan)
const chatHistory = new Map();
const MAX_HISTORY = 20;

// Kepribadian bot
const SYSTEM_PROMPT = `Kamu adalah teman ngobrol di server Discord. Ngobrol seperti orang biasa, santai, dan natural.
Aturan penting:
- Jawab sesuai topik yang ditanya, jangan belok ke topik lain
- Kalau ditanya nama, jawab nama kamu sesuai konteks (kamu bot di server ini)
- Bahasa Indonesia santai dan gaul, sesekali campur bahasa Inggris wajar
- Pakai emoji secukupnya, jangan berlebihan
- Jawaban singkat dan natural seperti chat biasa, bukan pidato
- Jangan kaku, jangan formal, jangan lebay
- Kalau diajak bercanda ya bercanda, kalau serius ya serius
- Jangan selalu mention UNO kecuali memang ditanya soal UNO atau game
- Kalau ditanya soal UNO atau mau main, baru sebut !uno start`;

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

async function chat(userId, username, message) {
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
          { role: 'system', content: SYSTEM_PROMPT },
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
