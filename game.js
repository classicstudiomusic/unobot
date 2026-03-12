const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_EMOJI = { red: '🔴', yellow: '🟡', green: '🟢', blue: '🔵' };
const COLOR_HEX = { red: '#FF4444', yellow: '#FFD700', green: '#44FF44', blue: '#4444FF' };
const COLOR_ID = { red: 0xFF4444, yellow: 0xFFD700, green: 0x44CC44, blue: 0x4488FF };

class Card {
  constructor(color, value, type) {
    this.color = color;   // red, yellow, green, blue, wild
    this.value = value;   // 0-9, skip, reverse, draw2, wild, wild4
    this.type = type;     // number, action, wild, wild4
    this.chosenColor = null; // for wild cards
  }

  toString() {
    const colorLabel = this.color === 'wild' ? '' : `${COLOR_EMOJI[this.color]} `;
    if (this.type === 'wild') return '🌈 Wild';
    if (this.type === 'wild4') return '🌈 Wild Draw 4';
    if (this.value === 'skip') return `${colorLabel}⏭️ Skip`;
    if (this.value === 'reverse') return `${colorLabel}🔄 Reverse`;
    if (this.value === 'draw2') return `${colorLabel}+2`;
    return `${colorLabel}${this.value}`;
  }

  emoji() {
    if (this.type === 'wild') return '🌈';
    if (this.type === 'wild4') return '💥';
    return COLOR_EMOJI[this.color];
  }

  effectiveColor() {
    if (this.color === 'wild' && this.chosenColor) return this.chosenColor;
    return this.color;
  }

  canPlayOn(topCard) {
    const myColor = this.effectiveColor();
    const topColor = topCard.effectiveColor();

    if (this.type === 'wild' || this.type === 'wild4') return true;
    if (myColor === topColor) return true;
    if (this.value === topCard.value) return true;
    return false;
  }
}

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    // 0 (one), 1-9 (two each)
    deck.push(new Card(color, 0, 'number'));
    for (let n = 1; n <= 9; n++) {
      deck.push(new Card(color, n, 'number'));
      deck.push(new Card(color, n, 'number'));
    }
    // Action cards x2
    for (let i = 0; i < 2; i++) {
      deck.push(new Card(color, 'skip', 'action'));
      deck.push(new Card(color, 'reverse', 'action'));
      deck.push(new Card(color, 'draw2', 'action'));
    }
  }
  // Wild cards x4
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
    this.direction = 1; // 1 = clockwise, -1 = counter
    this.pendingWild = null;
  }

  addPlayer(user) {
    this.players.push(new Player(user));
  }

  removePlayer(userId) {
    this.players = this.players.filter(p => p.id !== userId);
  }

  hasPlayer(userId) {
    return this.players.some(p => p.id === userId);
  }

  getPlayer(userId) {
    return this.players.find(p => p.id === userId);
  }

  getCurrentPlayer() {
    return this.players[this.currentIndex];
  }

  async startGame() {
    this.deck = shuffle(buildDeck());
    // Deal 7 cards each
    for (const player of this.players) {
      player.hand = this.deck.splice(0, 7);
    }
    // First card (non-wild)
    let first;
    do {
      first = this.deck.shift();
      if (first.type === 'wild' || first.type === 'wild4') {
        this.deck.push(first); // put back
        shuffle(this.deck);
      } else {
        break;
      }
    } while (true);
    this.discard.push(first);
    this.started = true;
    // Randomize who goes first
    this.currentIndex = Math.floor(Math.random() * this.players.length);
  }

  topCard() {
    return this.discard[this.discard.length - 1];
  }

  drawCard(player) {
    if (this.deck.length === 0) {
      // reshuffle discard except top
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = [top];
    }
    const card = this.deck.shift();
    player.hand.push(card);
    player.saidUno = false;
    return card;
  }

  getPlayableCards(player) {
    const top = this.topCard();
    return player.hand.filter(c => c.canPlayOn(top));
  }

  playCard(player, card) {
    // Remove from hand
    const idx = player.hand.indexOf(card);
    if (idx === -1) {
      // find by string match
      const match = player.hand.find(c => c.toString() === card.toString());
      if (match) player.hand.splice(player.hand.indexOf(match), 1);
    } else {
      player.hand.splice(idx, 1);
    }
    player.saidUno = false;

    this.discard.push(card);
    let message = `${COLOR_EMOJI[card.effectiveColor()] || '🌈'} **${player.name}** memainkan **${card.toString()}**`;

    // Check win
    if (player.hand.length === 0) {
      return { winner: player, message: message + '\n\n🏆 **HABIS KARTU!**' };
    }

    if (player.hand.length === 1 && !player.saidUno) {
      message += '\n⚠️ *(Pemain ini punya 1 kartu — tangkap kalau belum teriak UNO!)*';
    }

    // Apply card effects
    if (card.value === 'skip') {
      this.nextTurn();
      const skipped = this.getCurrentPlayer();
      message += `\n⏭️ **${skipped.name}** diskip!`;
      this.nextTurn();
    } else if (card.value === 'reverse') {
      this.direction *= -1;
      message += '\n🔄 Arah dibalik!';
      if (this.players.length === 2) {
        this.nextTurn(); // in 2-player, reverse = skip
      } else {
        this.nextTurn();
      }
    } else if (card.value === 'draw2') {
      this.nextTurn();
      const target = this.getCurrentPlayer();
      for (let i = 0; i < 2; i++) this.drawCard(target);
      message += `\n+2️⃣ **${target.name}** harus ambil 2 kartu dan diskip!`;
      this.nextTurn();
    } else if (card.type === 'wild') {
      message += `\n🌈 Warna berubah ke **${card.chosenColor}**!`;
      this.nextTurn();
    } else if (card.type === 'wild4') {
      this.nextTurn();
      const target = this.getCurrentPlayer();
      for (let i = 0; i < 4; i++) this.drawCard(target);
      message += `\n💥 **${target.name}** harus ambil 4 kartu dan diskip! Warna: **${card.chosenColor}**`;
      this.nextTurn();
    } else {
      this.nextTurn();
    }

    return { winner: null, message };
  }

  nextTurn() {
    this.currentIndex = (this.currentIndex + this.direction + this.players.length) % this.players.length;
  }

  // Embeds
  lobbyEmbed() {
    const playerList = this.players.map((p, i) => `${i === 0 ? '👑' : '👤'} ${p.name}`).join('\n');
    return new EmbedBuilder()
      .setTitle('🃏 Lobby UNO')
      .setColor('#FF6B35')
      .setDescription(`**Pemain (${this.players.length}/10):**\n${playerList}\n\n${this.started ? '✅ Game dimulai!' : '⏳ Menunggu pemain lain...\nGunakan `!uno join` untuk bergabung!'}`)
      .setFooter({ text: this.players.length > 0 ? `Host: ${this.players[0].name} | Minimal 2 pemain` : 'Lobby kosong' });
  }

  lobbyButtons() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('uno_begin').setLabel('▶️ Mulai Game').setStyle(ButtonStyle.Success),
    );
  }

  gameStateEmbed() {
    const current = this.getCurrentPlayer();
    const top = this.topCard();
    const topColor = top.effectiveColor();

    const playerList = this.players.map((p, i) => {
      const arrow = i === this.currentIndex ? (this.direction === 1 ? '▶️' : '◀️') : '　';
      const uno = p.hand.length === 1 ? ' 🔴UNO!' : '';
      return `${arrow} ${p.name} — **${p.hand.length}** kartu${uno}`;
    }).join('\n');

    return new EmbedBuilder()
      .setTitle('🃏 UNO — Giliran Bermain')
      .setColor(COLOR_ID[topColor] || 0xFF6B35)
      .addFields(
        { name: '🎴 Kartu Teratas', value: top.toString(), inline: true },
        { name: '🎨 Warna Aktif', value: `${COLOR_EMOJI[topColor] || '🌈'} ${topColor || 'wild'}`, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: `▶️ Giliran: **${current.name}**`, value: playerList }
      )
      .setFooter({ text: `Gunakan !uno hand untuk lihat kartumu via DM` });
  }

  gameButtons() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('uno_play').setLabel('🃏 Play Kartu').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('uno_draw').setLabel('🎲 Ambil Kartu').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('uno_shout').setLabel('🔴 UNO!').setStyle(ButtonStyle.Danger),
    );
  }

  handEmbed(player) {
    const groups = { red: [], yellow: [], green: [], blue: [], wild: [] };
    for (const card of player.hand) {
      const key = card.color === 'wild' ? 'wild' : card.color;
      groups[key].push(card.toString());
    }

    const fields = [];
    for (const [color, cards] of Object.entries(groups)) {
      if (cards.length > 0) {
        fields.push({ name: color === 'wild' ? '🌈 Wild' : `${COLOR_EMOJI[color]} ${color}`, value: cards.join('\n'), inline: true });
      }
    }

    return new EmbedBuilder()
      .setTitle(`🃏 Kartu Kamu — ${player.hand.length} kartu`)
      .setColor('#FF6B35')
      .addFields(fields)
      .setFooter({ text: 'Gunakan tombol "Play Kartu" di channel game' });
  }
}

module.exports = { UnoGame };
