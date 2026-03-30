// chat.js — Bot cerewet pakai Claude API

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Simpan riwayat chat per user (max 20 pesan biar tidak terlalu panjang)
const chatHistory = new Map();
const MAX_HISTORY = 20;

// Kepribadian bot
const SYSTEM_PROMPT = `Kamu adalah UNOBOT, bot Discord yang cerewet, lucu, dan sedikit jail.
Kamu juga jago main UNO dan sering pamer soal itu.
Karakter kamu:
- Cerewet dan ekspresif, suka pakai emoji
- Kadang suka godain orang tapi tetap ramah
- Bangga banget sama diri sendiri sebagai bot UNO terbaik
- Kalau diajak ngobrol soal UNO, langsung semangat
- Ngomong santai, gaul, kayak teman nongkrong
- Sesekali sombong tapi tetap lovable
- Bahasa Indonesia gaul, boleh campur dikit bahasa Inggris
- Jawaban singkat dan to the point, tidak bertele-tele
- Kalau ada yang nantang main UNO, suruh mereka ketik !uno start`;

function getHistory(userId) {
  if (!chatHistory.has(userId)) chatHistory.set(userId, []);
  return chatHistory.get(userId);
}

function addToHistory(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  // Batasi history
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function clearHistory(userId) {
  chatHistory.delete(userId);
}

async function chat(userId, username, message) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return '❌ ANTHROPIC_API_KEY belum diset! Tambahkan di Railway Variables.';
  }

  // Tambah konteks username
  const userMessage = `[${username}]: ${message}`;
  addToHistory(userId, 'user', userMessage);

  const history = getHistory(userId);

  try {
    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: history
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Anthropic API error:', err);
      return '😵 Aduh, otak gue lagi error nih. Coba lagi bentar ya!';
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || '🤔 Gue bingung mau jawab apa...';

    // Simpan balasan ke history
    addToHistory(userId, 'assistant', reply);

    return reply;
  } catch (e) {
    console.error('Chat error:', e);
    return '😵 Koneksi gue lagi gangguan nih. Coba lagi ya!';
  }
}

module.exports = { chat, clearHistory };
