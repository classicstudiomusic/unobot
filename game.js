const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_EMOJI = { red: '🔴', yellow: '🟡', green: '🟢', blue: '🔵' };
const COLOR_ID = { red: 0xFF4444, yellow: 0xFFD700, green: 0x44CC44, blue: 0x4488FF };
const BOT_ID = 'UNO_BOT_AI';

class Card {
  constructor(color, value, type) {
    this.color = color;
    this.value = value;
    this.type = type;
    this.chosenColor = null;
  }

  toString() {
    const e = this.color === 'wild' ? '' : `${COLOR_EMOJI[this.color]} `;
    if (this.type === 'wild')  return '🌈 Wild';
    if (this.type === 'wild4') return '🌈 Wild Draw 4';
    if (this.value === 'skip')    return `${e}⏭️ Skip`;
    if (this.value === 'reverse') return `${e}🔄 Reverse`;
    if (this.value === 'draw2')   return `${e}+2`;
    return `${e}${this.value}`;
  }

  emoji() {
    if (this.type === 'wild')  return '🌈';
    if (this.type === 'wild4') return '💥';
    return COLOR_EMOJI[this.color];
  }

  effectiveColor() {
    if (this.color === 'wild' && this.chosenColor) return this.chosenColor;
    return this.color;
  }

  canPlayOn(topCard, stackCount = 0) {
    // Kalau sedang stack +2, hanya +2 atau wild4 yang boleh
    if (stackCount > 0 && topCard.value === 'draw2') {
      return this.value === 'draw2' || this.type === 'wild4';
    }
    // Kalau sedang stack wild4, hanya wild4 yang boleh
    if (stackCount > 0 && topCard.type === 'wild4') {
      return this.type === 'wild4';
    }
    if (this.type === 'wild' || this.type === 'wild4') return true;
    if (this.effectiveColor() === topCard.effectiveColor()) return true;
    if (this.value === topCard.value && this.type === topCard.type) return true;
    return false;
  }
}

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push(new Card(color, 0, 'number'));
    for (let n = 1; n <= 9; n++) {
      deck.push(new Card(color, n, 'number'));
      deck.push(new Card(color, n, 'number'));
    }
    for (let i = 0; i < 2; i++) {
      deck.push(new Card(color, 'skip', 'action'));
      deck.push(new Card(color, 'reverse', 'action'));
      deck.push(new Card(color, 'draw2', 'action'));
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push(new Card('wild', 'wild', 'wild'));
    deck.push(new Card('wild', 'wild4', 'wild4'));
  }
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

class Player {
  constructor(user) {
    this.id = user.id;
    this.name = user.username;
    this.hand = [];
    this.saidUno = false;
    this.isBot = user.isBot || false;
  }
}

class UnoGame {
  constructor(channel) {
    this.channel = channel;
    this.players = [];
    this.started = false;
    this.deck = [];
    this.discard = [];
    this.currentIndex = 0;
    this.direction = 1;
    this.pendingWild = null;
    this.stackCount = 0;    // Jumlah kartu yang di-stack (+2/+4)
    this.stackType = null;  // 'draw2' atau 'wild4'
    this.turnTimer = null;  // Timer untuk auto-skip
  }

  addPlayer(user) { this.players.push(new Player(user)); }
  addBot(name)    { this.players.push(new Player({ id: BOT_ID, username: `🤖 ${name || 'UNO Bot'}`, isBot: true })); }

  removePlayer(userId) {
    this.players = this.players.filter(p => p.id !== userId);
  }

  hasPlayer(userId) { return this.players.some(p => p.id === userId); }
  getPlayer(userId) { return this.players.find(p => p.id === userId); }
  getCurrentPlayer() { return this.players[this.currentIndex]; }

  async startGame() {
    this.deck = shuffle(buildDeck());
    for (const player of this.players) {
      player.hand = this.deck.splice(0, 7);
    }
    let first;
    do {
      first = this.deck.shift();
      if (first.type === 'wild' || first.type === 'wild4') {
        this.deck.push(first);
        shuffle(this.deck);
      } else { break; }
    } while (true);
    this.discard.push(first);
    this.started = true;
    this.currentIndex = Math.floor(Math.random() * this.players.length);
  }

  topCard() { return this.discard[this.discard.length - 1]; }

  drawCard(player) {
    if (this.deck.length === 0) {
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = [top];
    }
    const card = this.deck.shift();
    player.hand.push(card);
    player.saidUno = false;
    return card;
  }

  // Ambil kartu yang bisa dimainkan, dengan mempertimbangkan stack
  getPlayableCards(player) {
    const top = this.topCard();
    return player.hand.filter(c => c.canPlayOn(top, this.stackCount));
  }

  // Cek apakah pemain bisa stack (punya +2 saat kena +2, atau +4 saat kena +4)
  canStack(player) {
    if (this.stackCount === 0) return false;
    return this.getPlayableCards(player).length > 0;
  }

  playCard(player, card) {
    const idx = player.hand.indexOf(card);
    if (idx === -1) {
      const match = player.hand.find(c => c.toString() === card.toString());
      if (match) player.hand.splice(player.hand.indexOf(match), 1);
    } else {
      player.hand.splice(idx, 1);
    }
    player.saidUno = false;
    this.discard.push(card);

    let message = `${COLOR_EMOJI[card.effectiveColor()] || '🌈'} **${player.name}** memainkan **${card.toString()}**`;

    if (player.hand.length === 0) {
      this.stackCount = 0;
      this.stackType = null;
      return { winner: player, message: message + '\n\n🏆 **HABIS KARTU!**' };
    }

    if (player.hand.length === 1 && !player.saidUno) {
      message += '\n⚠️ *(Punya 1 kartu — tangkap kalau belum teriak UNO!)*';
    }

    // Handle stacking +2
    if (card.value === 'draw2') {
      this.stackCount += 2;
      this.stackType = 'draw2';
      this.nextTurn();
      const next = this.getCurrentPlayer();
      if (this.canStack(next)) {
        message += `\n+2️⃣ Stack! Total: **+${this.stackCount}** — **${next.name}** bisa stack atau ambil ${this.stackCount} kartu!`;
      } else {
        // Tidak bisa stack, kena hukuman
        for (let i = 0; i < this.stackCount; i++) this.drawCard(next);
        message += `\n+2️⃣ **${next.name}** tidak bisa stack, ambil **${this.stackCount} kartu** dan diskip!`;
        this.stackCount = 0;
        this.stackType = null;
        this.nextTurn();
      }
    // Handle stacking Wild+4
    } else if (card.type === 'wild4') {
      this.stackCount += 4;
      this.stackType = 'wild4';
      this.nextTurn();
      const next = this.getCurrentPlayer();
      if (this.canStack(next)) {
        message += `\n💥 Stack! Total: **+${this.stackCount}** — **${next.name}** bisa stack Wild+4 atau ambil ${this.stackCount} kartu! Warna: **${card.chosenColor}**`;
      } else {
        for (let i = 0; i < this.stackCount; i++) this.drawCard(next);
        message += `\n💥 **${next.name}** tidak bisa stack, ambil **${this.stackCount} kartu** dan diskip! Warna: **${card.chosenColor}**`;
        this.stackCount = 0;
        this.stackType = null;
        this.nextTurn();
      }
    } else if (card.value === 'skip') {
      this.nextTurn();
      const skipped = this.getCurrentPlayer();
      message += `\n⏭️ **${skipped.name}** diskip!`;
      this.nextTurn();
    } else if (card.value === 'reverse') {
      this.direction *= -1;
      message += '\n🔄 Arah dibalik!';
      this.nextTurn();
    } else if (card.type === 'wild') {
      message += `\n🌈 Warna berubah ke **${card.chosenColor}**!`;
      this.nextTurn();
    } else {
      this.nextTurn();
    }

    return { winner: null, message };
  }

  // Pemain menyerah / tidak bisa stack, ambil semua kartu yang di-stack
  forceDrawStack(player) {
    const total = this.stackCount;
    for (let i = 0; i < total; i++) this.drawCard(player);
    this.stackCount = 0;
    this.stackType = null;
    this.nextTurn();
    return total;
  }

  nextTurn() {
    this.currentIndex = (this.currentIndex + this.direction + this.players.length) % this.players.length;
  }

  // Bot AI
  botChooseCard() {
    const bot = this.getCurrentPlayer();
    const playable = this.getPlayableCards(bot);
    if (!playable.length) return null;
    const priority = (c) => {
      if (c.type === 'wild4')       return 6;
      if (c.value === 'draw2')      return 5;
      if (c.value === 'skip')       return 4;
      if (c.value === 'reverse')    return 3;
      if (c.type === 'wild')        return 2;
      return 1 + (Number(c.value) || 0) / 10;
    };
    return playable.sort((a, b) => priority(b) - priority(a))[0];
  }

  botChooseColor() {
    const bot = this.getCurrentPlayer();
    const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
    for (const c of bot.hand) { if (counts[c.color] !== undefined) counts[c.color]++; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Embeds & buttons
  lobbyEmbed() {
    const list = this.players.map((p, i) => `${i === 0 ? '👑' : '👤'} ${p.name}`).join('\n');
    return new EmbedBuilder()
      .setTitle('🃏 Lobby UNO')
      .setColor('#FF6B35')
      .setDescription(`**Pemain (${this.players.length}/10):**\n${list}\n\n${this.started ? '✅ Game dimulai!' : '⏳ Menunggu...\nGunakan `!uno join` untuk bergabung!'}`)
      .setFooter({ text: `Host: ${this.players[0]?.name || '-'} | Min 2 pemain` });
  }

  lobbyButtons() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('uno_begin').setLabel('▶️ Mulai Game').setStyle(ButtonStyle.Success)
    );
  }

  gameStateEmbed(timeLeft = 15) {
    const cur = this.getCurrentPlayer();
    const top = this.topCard();
    const topColor = top.effectiveColor();
    const list = this.players.map((p, i) => {
      const arrow = i === this.currentIndex ? (this.direction === 1 ? '▶️' : '◀️') : '　';
      const uno = p.hand.length === 1 ? ' 🔴 UNO!' : '';
      return `${arrow} ${p.name} — **${p.hand.length}** kartu${uno}`;
    }).join('\n');

    const stackInfo = this.stackCount > 0
      ? `\n⚠️ **Stack aktif: +${this.stackCount}** — harus stack atau ambil ${this.stackCount} kartu!`
      : '';

    return new EmbedBuilder()
      .setTitle('🃏 UNO')
      .setColor(COLOR_ID[topColor] || 0xFF6B35)
      .addFields(
        { name: '🎴 Kartu Teratas', value: top.toString(), inline: true },
        { name: '🎨 Warna Aktif', value: `${COLOR_EMOJI[topColor] || '🌈'} ${topColor}`, inline: true },
        { name: '⏱️ Waktu', value: `${timeLeft} detik`, inline: true },
        { name: `▶️ Giliran: **${cur.name}**`, value: list + stackInfo }
      )
      .setFooter({ text: '!uno hand untuk lihat kartumu via DM' });
  }

  gameButtons() {
    const catchable = this.players.find(p => p.hand.length === 1 && !p.saidUno);
    const hasStack = this.stackCount > 0;
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('uno_play').setLabel(hasStack ? `🃏 Stack / Play` : '🃏 Play Kartu').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('uno_draw').setLabel(hasStack ? `🎲 Ambil +${this.stackCount}` : '🎲 Ambil Kartu').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('uno_shout').setLabel('🔴 UNO!').setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('uno_catch')
        .setLabel(catchable ? `🫵 Tangkap ${catchable.name}!` : '🫵 Tangkap UNO')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!catchable),
    );
  }

  handEmbed(player) {
    const groups = { red: [], yellow: [], green: [], blue: [], wild: [] };
    for (const card of player.hand) {
      groups[card.color === 'wild' ? 'wild' : card.color].push(card.toString());
    }
    const fields = Object.entries(groups)
      .filter(([, cards]) => cards.length > 0)
      .map(([color, cards]) => ({
        name: color === 'wild' ? '🌈 Wild' : `${COLOR_EMOJI[color]} ${color}`,
        value: cards.join('\n'), inline: true
      }));
    return new EmbedBuilder()
      .setTitle(`🃏 Kartu Kamu — ${player.hand.length} kartu`)
      .setColor('#FF6B35')
      .addFields(fields)
      .setFooter({ text: 'Gunakan tombol "Play Kartu" di channel game' });
  }
}

module.exports = { UnoGame, BOT_ID };
