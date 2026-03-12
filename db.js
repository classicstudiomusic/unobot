const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'uno_stats.bin');

let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(data);
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      points INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      games_played INTEGER DEFAULT 0
    );
  `);
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

const POINTS = {
  WIN_BASE: 100,
  WIN_BONUS_PER_CARD: 5,
  PARTICIPATE: 10,
  UNO_BONUS: 20,
};

const RANKS = [
  { name: '🥉 Pemula',    min: 0    },
  { name: '⚔️ Petarung',  min: 200  },
  { name: '🥈 Ahli',      min: 500  },
  { name: '🥇 Master',    min: 1000 },
  { name: '💎 Legend',    min: 2000 },
  { name: '👑 UNO King',  min: 5000 },
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

function ensurePlayer(userId, username) {
  if (!db) return;
  const res = db.exec(`SELECT user_id FROM players WHERE user_id='${userId}'`);
  if (!res.length || !res[0].values.length) {
    db.run(`INSERT INTO players (user_id, username) VALUES (?, ?)`, [userId, username]);
  } else {
    db.run(`UPDATE players SET username=? WHERE user_id=?`, [username, userId]);
  }
  saveDb();
}

function getPlayer(userId) {
  if (!db) return null;
  const res = db.exec(`SELECT * FROM players WHERE user_id='${userId}'`);
  if (!res.length || !res[0].values.length) return null;
  const [cols, vals] = [res[0].columns, res[0].values[0]];
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
}

function recordGameEnd(winner, allPlayers) {
  if (!db) return [];
  const totalCardsLeft = allPlayers.filter(p => p.id !== winner.id).reduce((s, p) => s + p.hand.length, 0);
  const bonusCards = totalCardsLeft * POINTS.WIN_BONUS_PER_CARD;
  const unoBonus = winner.saidUno ? POINTS.UNO_BONUS : 0;
  const winnerPoints = POINTS.WIN_BASE + bonusCards + unoBonus;

  const results = [];
  for (const p of allPlayers) {
    ensurePlayer(p.id, p.name);
    const isWinner = p.id === winner.id;
    const gained = isWinner ? winnerPoints : POINTS.PARTICIPATE;
    db.run(`UPDATE players SET points=points+?, wins=wins+?, games_played=games_played+1 WHERE user_id=?`,
      [gained, isWinner ? 1 : 0, p.id]);
    const updated = getPlayer(p.id);
    results.push({
      id: p.id, name: p.name, isWinner,
      pointsGained: gained,
      totalPoints: updated?.points || gained,
      breakdown: isWinner ? { base: POINTS.WIN_BASE, cards: bonusCards, uno: unoBonus } : null
    });
  }
  saveDb();
  return results;
}

function getLeaderboard(limit = 10) {
  if (!db) return [];
  const res = db.exec(`SELECT * FROM players ORDER BY points DESC LIMIT ${limit}`);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(vals => Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
}

function getPlayerStats(userId) {
  return getPlayer(userId);
}

module.exports = { getDb, recordGameEnd, getLeaderboard, getPlayerStats, ensurePlayer, getRank, getNextRank, POINTS, RANKS };
