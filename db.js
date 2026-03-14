const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Railway Volume: mount ke /data, kalau tidak ada pakai lokal
const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uno_stats.bin')
  : path.join(__dirname, 'uno_stats.bin');
let db = null;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('📂 Database dimuat dari file.');
  } else {
    db = new SQL.Database();
    console.log('🆕 Database baru dibuat.');
  }

  // Tabel global (semua server)
  db.run(`CREATE TABLE IF NOT EXISTS players (
    user_id   TEXT PRIMARY KEY,
    username  TEXT NOT NULL,
    points    INTEGER DEFAULT 0,
    wins      INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0
  )`);

  // Tabel per server
  db.run(`CREATE TABLE IF NOT EXISTS server_players (
    user_id   TEXT NOT NULL,
    guild_id  TEXT NOT NULL,
    username  TEXT NOT NULL,
    points    INTEGER DEFAULT 0,
    wins      INTEGER DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id)
  )`);

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
  catch (e) { console.error('❌ Gagal simpan DB:', e.message); }
}

const POINTS = {
  WIN_BASE: 100,
  PARTICIPATE: 10,
  UNO_BONUS: 20,
};

const RANKS = [
  { name: '🥉 Pemula',   min: 0    },
  { name: '⚔️ Petarung', min: 200  },
  { name: '🥈 Ahli',     min: 500  },
  { name: '🥇 Master',   min: 1000 },
  { name: '💎 Legend',   min: 2000 },
  { name: '👑 UNO King', min: 5000 },
];

function getRank(points) {
  let rank = RANKS[0];
  for (const r of RANKS) { if (points >= r.min) rank = r; }
  return rank;
}

function getNextRank(points) {
  for (const r of RANKS) { if (points < r.min) return r; }
  return null;
}

function cardPoints(card) {
  if (card.type === 'wild' || card.type === 'wild4') return 50;
  if (card.value === 'skip' || card.value === 'reverse' || card.value === 'draw2') return 20;
  return Number(card.value) || 0;
}

function ensurePlayer(userId, username, guildId) {
  if (!db) return;
  // Global
  const g = db.exec(`SELECT user_id FROM players WHERE user_id='${userId}'`);
  if (!g.length || !g[0].values.length) {
    db.run(`INSERT INTO players (user_id, username) VALUES (?, ?)`, [userId, username]);
  } else {
    db.run(`UPDATE players SET username=? WHERE user_id=?`, [username, userId]);
  }
  // Per server
  if (guildId) {
    const s = db.exec(`SELECT user_id FROM server_players WHERE user_id='${userId}' AND guild_id='${guildId}'`);
    if (!s.length || !s[0].values.length) {
      db.run(`INSERT INTO server_players (user_id, guild_id, username) VALUES (?, ?, ?)`, [userId, guildId, username]);
    } else {
      db.run(`UPDATE server_players SET username=? WHERE user_id=? AND guild_id=?`, [username, userId, guildId]);
    }
  }
  saveDb();
}

function getPlayer(userId) {
  if (!db) return null;
  const res = db.exec(`SELECT * FROM players WHERE user_id='${userId}'`);
  if (!res.length || !res[0].values.length) return null;
  return Object.fromEntries(res[0].columns.map((c, i) => [c, res[0].values[0][i]]));
}

function getServerPlayer(userId, guildId) {
  if (!db) return null;
  const res = db.exec(`SELECT * FROM server_players WHERE user_id='${userId}' AND guild_id='${guildId}'`);
  if (!res.length || !res[0].values.length) return null;
  return Object.fromEntries(res[0].columns.map((c, i) => [c, res[0].values[0][i]]));
}

function recordGameEnd(winner, allPlayers, guildId) {
  if (!db) { console.error('DB belum siap!'); return []; }

  const totalCardValue = allPlayers
    .filter(p => p.id !== winner.id && !p.isBot)
    .reduce((s, p) => s + p.hand.reduce((sum, card) => sum + cardPoints(card), 0), 0);
  const unoBonus = winner.saidUno ? POINTS.UNO_BONUS : 0;
  const winnerPoints = POINTS.WIN_BASE + totalCardValue + unoBonus;

  const results = [];
  for (const p of allPlayers) {
    if (p.isBot) continue; // skip bot AI
    ensurePlayer(p.id, p.name, guildId);
    const isWinner = p.id === winner.id;
    const gained = isWinner ? winnerPoints : POINTS.PARTICIPATE;

    // Update global
    db.run(`UPDATE players SET points=points+?, wins=wins+?, games_played=games_played+1 WHERE user_id=?`,
      [gained, isWinner ? 1 : 0, p.id]);

    // Update per server
    if (guildId) {
      db.run(`UPDATE server_players SET points=points+?, wins=wins+?, games_played=games_played+1 WHERE user_id=? AND guild_id=?`,
        [gained, isWinner ? 1 : 0, p.id, guildId]);
    }

    const updatedGlobal = getPlayer(p.id);
    const updatedServer = guildId ? getServerPlayer(p.id, guildId) : null;
    results.push({
      id: p.id, name: p.name, isWinner,
      pointsGained: gained,
      totalPoints: updatedGlobal ? updatedGlobal.points : gained,
      serverPoints: updatedServer ? updatedServer.points : gained,
      breakdown: isWinner ? { base: POINTS.WIN_BASE, cardValue: totalCardValue, uno: unoBonus } : null
    });
  }
  saveDb();
  console.log(`✅ Game disimpan. Pemenang: ${winner.name} +${winnerPoints} pts`);
  return results;
}

function getLeaderboard(limit = 10) {
  if (!db) return [];
  const res = db.exec(`SELECT * FROM players ORDER BY points DESC LIMIT ${limit}`);
  if (!res.length) return [];
  return res[0].values.map(vals => Object.fromEntries(res[0].columns.map((c, i) => [c, vals[i]])));
}

function getServerLeaderboard(guildId, limit = 10) {
  if (!db) return [];
  const res = db.exec(`SELECT * FROM server_players WHERE guild_id='${guildId}' ORDER BY points DESC LIMIT ${limit}`);
  if (!res.length) return [];
  return res[0].values.map(vals => Object.fromEntries(res[0].columns.map((c, i) => [c, vals[i]])));
}

function getPlayerStats(userId, guildId) {
  const global = getPlayer(userId);
  const server = guildId ? getServerPlayer(userId, guildId) : null;
  return { global, server };
}

module.exports = {
  initDb, recordGameEnd,
  getLeaderboard, getServerLeaderboard,
  getPlayerStats, ensurePlayer,
  getRank, getNextRank, POINTS, RANKS
};
