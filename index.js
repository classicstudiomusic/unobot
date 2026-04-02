require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { UnoGame, BOT_ID } = require('./game');
const { chat, clearHistory } = require('./chat');
const { initDb, recordGameEnd, getLeaderboard, getServerLeaderboard, getPlayerStats, ensurePlayer, getRank, getNextRank } = require('./db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const games = new Map();

client.once('ready', () => {
  console.log(`✅ Bot ${client.user.tag} sudah online!`);
  client.user.setActivity('🃏 UNO | !uno help');
});

client.on('messageCreate', async (message) => {
  try {
  if (message.author.bot) return;

  // ── Command !uno — diproses duluan, tidak boleh ditimpa nimbrung ──
  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args[0].toLowerCase();
    const channelId = message.channel.id;

    if (command === 'uno') {
      const sub = args[1]?.toLowerCase();

      if (!sub || sub === 'help') return message.channel.send({ embeds: [helpEmbed()] });

      if (sub === 'start') {
        if (games.has(channelId)) return message.reply('❌ Sudah ada game aktif di channel ini!');
        const game = new UnoGame(message.channel);
        games.set(channelId, game);
        game.addPlayer(message.author);
        ensurePlayer(message.author.id, message.author.username, message.guild?.id);
        return message.channel.send({ embeds: [game.lobbyEmbed()], components: [game.lobbyButtons()] });
      }

      if (sub === 'solo' || sub === 'bot') {
        if (games.has(channelId)) return message.reply('❌ Sudah ada game aktif di channel ini!');
        const game = new UnoGame(message.channel);
        games.set(channelId, game);
        game.addPlayer(message.author);
        game.addBot(client.user.username);
        ensurePlayer(message.author.id, message.author.username, message.guild?.id);
        return message.channel.send({ embeds: [game.lobbyEmbed()], components: [game.lobbyButtons()] });
      }

      if (sub === 'join') {
        const game = games.get(channelId);
        if (!game) return message.reply('❌ Tidak ada game. Gunakan `!uno start`.');
        if (game.started) return message.reply('❌ Game sudah berjalan!');
        if (game.hasPlayer(message.author.id)) return message.reply('❌ Kamu sudah join!');
        if (game.players.length >= 10) return message.reply('❌ Game penuh!');
        game.addPlayer(message.author);
        ensurePlayer(message.author.id, message.author.username, message.guild?.id);
        return message.channel.send({ embeds: [game.lobbyEmbed()], components: [game.lobbyButtons()] });
      }

      if (sub === 'leave') {
        const game = games.get(channelId);
        if (!game) return message.reply('❌ Tidak ada game.');
        if (!game.hasPlayer(message.author.id)) return message.reply('❌ Kamu tidak dalam game ini.');
        const leavingName = message.author.username;
        game.removePlayer(message.author.id);
        if (!game.started) {
          if (game.players.length === 0) { games.delete(channelId); return message.channel.send('🗑️ Game dibatalkan.'); }
          return message.channel.send(`👋 **${leavingName}** keluar dari lobby.`);
        }
        await message.channel.send(`🚪 **${leavingName}** keluar dari game!`);
        if (game.players.length === 1) {
          const winner = game.players[0];
          const pts = recordGameEnd(winner, [...game.players, { id: message.author.id, name: leavingName, hand: [], saidUno: false }], message.guild?.id);
          game.started = false;
          games.delete(channelId);
          clearTurnTimer(channelId);
          return message.channel.send({ embeds: [winEmbed(winner, pts, true)] });
        }
        if (game.players.length === 0) { games.delete(channelId); return message.channel.send('🗑️ Semua pemain keluar. Game berakhir.'); }
        if (game.currentIndex >= game.players.length) game.currentIndex = 0;
        return sendGameState(game, message.channel, message.guild?.id);
      }

      if (sub === 'stop') {
        if (!games.has(channelId)) return message.reply('❌ Tidak ada game aktif.');
        games.delete(channelId);
        clearTurnTimer(channelId);
        return message.channel.send('🛑 Game dihentikan!');
      }

      if (sub === 'hand' || sub === 'kartu') {
        const game = games.get(channelId);
        if (!game || !game.started) return message.reply('❌ Tidak ada game aktif.');
        if (!game.hasPlayer(message.author.id)) return message.reply('❌ Kamu tidak dalam game ini.');
        try {
          await message.author.send({ embeds: [game.handEmbed(game.getPlayer(message.author.id))] });
          return message.reply('📬 Kartumu dikirim via DM!');
        } catch { return message.reply('❌ Aktifkan DM dari server ini!'); }
      }

      if (sub === 'rank' || sub === 'ranking' || sub === 'profil') {
        const target = message.mentions.users.first() || message.author;
        const stats = getPlayerStats(target.id, message.guild?.id);
        if (!stats.global) return message.channel.send(`❌ **${target.username}** belum pernah main UNO!`);
        return message.channel.send({ embeds: [profileEmbed(stats, target)] });
      }

      if (sub === 'leaderboard' || sub === 'lb' || sub === 'top') {
        const scope = args[2]?.toLowerCase();
        if (scope === 'global') {
          return message.channel.send({ embeds: [leaderboardEmbed(getLeaderboard(10), false)] });
        }
        const serverBoard = getServerLeaderboard(message.guild?.id, 10);
        const embed = serverBoard.length
          ? leaderboardEmbed(serverBoard, true, message.guild?.name)
          : leaderboardEmbed(getLeaderboard(10), false);
        return message.channel.send({ embeds: [embed] });
      }
    }
    return; // command lain selain !uno, abaikan
  }

  // ── Bot cerewet: aktif kalau di-mention ATAU nimbrung random ──
  const isMentioned = message.mentions.has(client.user);
  const shouldNimbrung = !isMentioned && Math.random() < 0.5;

  if (isMentioned || shouldNimbrung) {
    const text = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!text) return;

    if (isMentioned && (text.toLowerCase() === 'reset' || text.toLowerCase() === 'lupa')) {
      clearHistory(message.author.id);
      return message.reply('🧹 Oke gue lupa deh semua obrolan kita. Fresh start!');
    }

    try { await message.channel.sendTyping(); } catch {}

    const reply = await chat(message.author.id, message.author.username, text, client.user.username);

    try {
      if (isMentioned) {
        return await message.reply(reply);
      } else {
        return await message.channel.send(reply);
      }
    } catch (e) {
      console.error('Gagal kirim pesan nimbrung:', e.message);
    }
  }

  } catch(e) { console.error("⚠️ messageCreate error:", e?.message || e); }
});

client.on('interactionCreate', async (interaction) => {
  try {
  const channelId = interaction.channelId;
  const game = games.get(channelId);

  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id === 'uno_begin') {
      if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan.', ephemeral: true });
      if (game.players[0].id !== interaction.user.id) return interaction.reply({ content: '❌ Hanya host!', ephemeral: true });
      // Kalau sendirian, otomatis tambah bot dengan nama asli bot
      if (game.players.length === 1) {
        game.addBot(client.user.username);
        await interaction.channel.send(`🤖 Tidak ada lawan, **${client.user.username}** ikut main!`);
      }
      await game.startGame();
      await interaction.update({ embeds: [game.lobbyEmbed()], components: [] });
      return sendGameState(game, interaction.channel, interaction.guild?.id);
    }

    if (id === 'uno_draw') {
      if (!game?.started) return interaction.reply({ content: '❌ Tidak ada game aktif.', ephemeral: true });
      const cur = game.getCurrentPlayer();
      if (interaction.user.id !== cur.id) return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });

      clearTurnTimer(interaction.channelId);

      if (game.stackCount > 0) {
        // Ambil semua kartu yang di-stack
        const total = game.forceDrawStack(cur);
        await interaction.reply({ content: `🎲 Kamu ambil **${total} kartu** karena stack!`, ephemeral: true });
        await interaction.channel.send(`🎲 **${cur.name}** menyerah dan ambil **${total} kartu**!`);
      } else {
        const drawn = game.drawCard(cur);
        await interaction.reply({ content: `🃏 Kamu ambil: **${drawn.toString()}**`, ephemeral: true });
        await interaction.channel.send(`🎲 **${cur.name}** mengambil 1 kartu.`);
        game.nextTurn();
      }
      return sendGameState(game, interaction.channel, interaction.guild?.id);
    }

    if (id === 'uno_catch') {
      if (!game?.started) return interaction.reply({ content: '❌ Tidak ada game aktif.', ephemeral: true });
      const target = game.players.find(p => p.hand.length === 1 && !p.saidUno);
      if (!target) return interaction.reply({ content: '❌ Tidak ada yang bisa ditangkap!', ephemeral: true });
      if (target.id === interaction.user.id) return interaction.reply({ content: '❌ Tidak bisa menangkap diri sendiri!', ephemeral: true });
      game.drawCard(target);
      game.drawCard(target);
      return interaction.reply({ content: `🫵 **${interaction.user.username}** menangkap **${target.name}** yang lupa teriak UNO!\n💀 **${target.name}** kena hukuman ambil **2 kartu!**` });
    }

    if (id === 'uno_play') {
      if (!game?.started) return interaction.reply({ content: '❌ Tidak ada game aktif.', ephemeral: true });
      const cur = game.getCurrentPlayer();
      if (interaction.user.id !== cur.id) return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });
      const playable = game.getPlayableCards(cur);
      if (!playable.length) {
        if (game.stackCount > 0) return interaction.reply({ content: `❌ Kamu tidak punya kartu untuk stack! Tekan **Ambil +${game.stackCount}** untuk ambil kartu.`, ephemeral: true });
        return interaction.reply({ content: '❌ Tidak ada kartu yang bisa dimainkan!', ephemeral: true });
      }
      const select = new StringSelectMenuBuilder().setCustomId('uno_select_card').setPlaceholder('Pilih kartu...')
        .addOptions(playable.map((c, i) => ({ label: c.toString(), value: `${i}`, emoji: c.emoji() })));
      return interaction.reply({ content: '🃏 Pilih kartu:', components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    if (id === 'uno_shout') {
      if (!game?.started) return interaction.reply({ content: '❌ Tidak ada game aktif.', ephemeral: true });
      const p = game.getPlayer(interaction.user.id);
      if (!p) return interaction.reply({ content: '❌ Kamu tidak dalam game.', ephemeral: true });
      if (p.hand.length === 1) { p.saidUno = true; return interaction.reply({ content: `🔴 **${p.name}** teriak **UNO!** 🎉` }); }
      return interaction.reply({ content: '❌ Kamu tidak bisa UNO sekarang.', ephemeral: true });
    }

    if (id.startsWith('color_')) {
      if (!game?.started || !game.pendingWild) return interaction.reply({ content: '❌ Tidak ada wild pending.', ephemeral: true });
      const { player, card } = game.pendingWild;
      if (interaction.user.id !== player.id) return interaction.reply({ content: '❌ Bukan kartumu!', ephemeral: true });
      card.chosenColor = { color_red: 'red', color_yellow: 'yellow', color_green: 'green', color_blue: 'blue' }[id];
      game.pendingWild = null;
      await interaction.update({ content: `✅ Warna: **${card.chosenColor}**`, components: [] });
      const result = game.playCard(player, card);
      await interaction.channel.send(result.message);
      if (result.winner) {
        const pts = recordGameEnd(result.winner, game.players, interaction.guild?.id);
        games.delete(channelId);
        clearTurnTimer(channelId);
        return interaction.channel.send({ embeds: [winEmbed(result.winner, pts)] });
      }
      return sendGameState(game, interaction.channel, interaction.guild?.id);
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'uno_select_card') {
    if (!game?.started) return interaction.reply({ content: '❌ Tidak ada game aktif.', ephemeral: true });
    const cur = game.getCurrentPlayer();
    if (interaction.user.id !== cur.id) return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });
    const card = game.getPlayableCards(cur)[parseInt(interaction.values[0])];
    if (!card) return interaction.reply({ content: '❌ Kartu tidak valid.', ephemeral: true });

    if (card.type === 'wild' || card.type === 'wild4') {
      game.pendingWild = { player: cur, card };
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('color_red').setLabel('🔴 Merah').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('color_yellow').setLabel('🟡 Kuning').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('color_green').setLabel('🟢 Hijau').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('color_blue').setLabel('🔵 Biru').setStyle(ButtonStyle.Secondary),
      );
      return interaction.update({ content: `🌈 Pilih warna untuk **${card.toString()}**:`, components: [row] });
    }

    await interaction.update({ content: `✅ Memainkan **${card.toString()}**...`, components: [] });
    const result = game.playCard(cur, card);
    await interaction.channel.send(result.message);
    if (result.winner) {
      const pts = recordGameEnd(result.winner, game.players, interaction.guild?.id);
      game.started = false;
      games.delete(channelId);
      clearTurnTimer(channelId);
      return interaction.channel.send({ embeds: [winEmbed(result.winner, pts)] });
    }
    return sendGameState(game, interaction.channel, interaction.guild?.id);
  }
  } catch(e) { console.error("⚠️ interactionCreate error:", e?.message || e); }
});

// Map untuk menyimpan timer per channel
const turnTimers = new Map();

function clearTurnTimer(channelId) {
  if (turnTimers.has(channelId)) {
    clearTimeout(turnTimers.get(channelId));
    turnTimers.delete(channelId);
  }
}

async function sendGameState(game, channel, guildId) {
  clearTurnTimer(channel.id);
  const cur = game.getCurrentPlayer();
  if (!cur) return;

  // Tag player (bukan bot)
  if (!cur.isBot) {
    await channel.send(`<@${cur.id}> giliran kamu! ⏱️ 25 detik...`);
  }

  await channel.send({ embeds: [game.gameStateEmbed(25)], components: [game.gameButtons()] });

  // Kalau giliran bot, jalankan setelah 2 detik
  if (cur.isBot) {
    const t = setTimeout(() => runBotTurn(game, channel, guildId), 2000);
    turnTimers.set(channel.id, t);
    return;
  }

  // Timer 15 detik untuk pemain manusia
  let timeLeft = 25;
  const t = setTimeout(async () => {
    turnTimers.delete(channel.id);
    if (!game.started) return;
    const stillCurrent = game.getCurrentPlayer();
    if (!stillCurrent || stillCurrent.id !== cur.id) return;

    // Auto: kalau ada stack, ambil semua kartu stack
    if (game.stackCount > 0) {
      const total = game.forceDrawStack(stillCurrent);
      await channel.send(`⏰ Waktu habis! **${cur.name}** otomatis ambil **${total} kartu**!`);
    } else {
      // Auto: ambil 1 kartu lalu skip
      game.drawCard(stillCurrent);
      game.nextTurn();
      await channel.send(`⏰ Waktu habis! **${cur.name}** otomatis ambil 1 kartu dan diskip.`);
    }

    // Cek apakah game masih ada
    if (!games.has(channel.id)) return;
    return sendGameState(game, channel, guildId);
  }, 25000);
  turnTimers.set(channel.id, t);
}

async function runBotTurn(game, channel, guildId) {
  if (!game.started) return;
  const bot = game.getCurrentPlayer();
  if (!bot || !bot.isBot) return;

  // Bot handle stack
  if (game.stackCount > 0) {
    const card = game.botChooseCard();
    if (card && (card.value === 'draw2' || card.type === 'wild4')) {
      if (card.type === 'wild' || card.type === 'wild4') card.chosenColor = game.botChooseColor();
      const result = game.playCard(bot, card);
      await channel.send(`🤖 ${result.message}`);
      if (result.winner) {
        const pts = recordGameEnd(result.winner, game.players, guildId);
        result.winner.game_started = false;
        game.started = false;
        games.delete(channel.id);
        clearTurnTimer(channel.id);
        return channel.send({ embeds: [winEmbed(result.winner, pts)] });
      }
      return sendGameState(game, channel, guildId);
    } else {
      // Bot tidak bisa stack, kena hukuman
      const total = game.forceDrawStack(bot);
      await channel.send(`🤖 **${bot.name}** tidak bisa stack, ambil **${total} kartu**!`);
      return sendGameState(game, channel, guildId);
    }
  }

  const card = game.botChooseCard();
  if (!card) {
    game.drawCard(bot);
    await channel.send(`🤖 **${bot.name}** mengambil 1 kartu.`);
    game.nextTurn();
    return sendGameState(game, channel, guildId);
  }

  if (card.type === 'wild' || card.type === 'wild4') card.chosenColor = game.botChooseColor();
  if (bot.hand.length === 2) { bot.saidUno = true; await channel.send(`🤖 **${bot.name}**: *UNO!* 🔴`); }

  const result = game.playCard(bot, card);
  await channel.send(`🤖 ${result.message}`);

  if (result.winner) {
    const pts = recordGameEnd(result.winner, game.players, guildId);
    games.delete(channel.id);
    clearTurnTimer(channel.id);
    return channel.send({ embeds: [winEmbed(result.winner, pts)] });
  }
  return sendGameState(game, channel, guildId);
}

function winEmbed(winner, pointResults, walkover = false) {
  const wr = pointResults.find(r => r.isWinner);
  if (!wr) return new EmbedBuilder().setTitle('🏆 Game Selesai').setColor('#FFD700').setDescription(`**${winner.name}** menang!`);
  const others = pointResults.filter(r => !r.isWinner);
  const bk = wr.breakdown;
  const rank = getRank(wr.totalPoints);
  const next = getNextRank(wr.totalPoints);

  const title = walkover ? '🏆 SEMUA PEMAIN KELUAR!' : '🏆 GAME SELESAI!';
  const desc = walkover
    ? `# 🎉 **${winner.name}** menang karena semua lawan keluar!\n**Rank:** ${rank.name}`
    : `# 🎉 **${winner.name}** MENANG!\n**Rank:** ${rank.name}`;

  const pointBreakdown = bk
    ? `🏆 Menang: +${bk.base} pts\n🃏 Nilai kartu sisa lawan: +${bk.cardValue} pts` + (bk.uno > 0 ? `\n🔴 UNO bonus: +${bk.uno} pts` : '') + `\n\n**Total: +${wr.pointsGained} → ${wr.totalPoints} pts**`
    : `**+${wr.pointsGained} pts → ${wr.totalPoints} pts total**`;

  return new EmbedBuilder()
    .setTitle(title)
    .setColor('#FFD700')
    .setDescription(desc)
    .addFields(
      { name: `✨ Poin ${winner.name}`, value: pointBreakdown },
      { name: '👥 Pemain Lain', value: others.map(r => `${r.name}: +${r.pointsGained} pts (total: ${r.totalPoints})`).join('\n') || '-' },
      { name: '📈 Progress', value: next ? `Menuju ${next.name}: ${wr.totalPoints}/${next.min} pts` : '👑 Rank Maksimal!' }
    ).setTimestamp();
}

function progressBar(points, next) {
  if (!next) return '👑 Rank Tertinggi!';
  const allMins = [0, 200, 500, 1000, 2000, 5000];
  const prevMin = allMins.filter(r => r <= points && r < next.min).pop() || 0;
  const filled = Math.min(10, Math.floor(((points - prevMin) / (next.min - prevMin)) * 10));
  return '[' + '█'.repeat(filled) + '░'.repeat(10 - filled) + '] ' + points + '/' + next.min + ' pts';
}

function profileEmbed(stats, user) {
  const g = stats.global;
  const s = stats.server;
  const gRank = getRank(g.points);
  const gNext = getNextRank(g.points);
  const gWR = g.games_played > 0 ? ((g.wins / g.games_played) * 100).toFixed(1) : '0';

  const fields = [
    { name: '🌍 Rank Global', value: gRank.name, inline: true },
    { name: '⭐ Poin Global', value: g.points.toLocaleString() + ' pts', inline: true },
    { name: '📊 WR Global', value: gWR + '%', inline: true },
    { name: '🏆 Total Menang', value: '' + g.wins, inline: true },
    { name: '🎮 Total Game', value: '' + g.games_played, inline: true },
    { name: '\u200B', value: '\u200B', inline: true },
    { name: '📈 Progress Global', value: progressBar(g.points, gNext) },
  ];

  if (s) {
    const sRank = getRank(s.points);
    const sNext = getNextRank(s.points);
    const sWR = s.games_played > 0 ? ((s.wins / s.games_played) * 100).toFixed(1) : '0';
    fields.push(
      { name: '🏠 Rank Server', value: sRank.name, inline: true },
      { name: '⭐ Poin Server', value: s.points.toLocaleString() + ' pts', inline: true },
      { name: '📊 WR Server', value: sWR + '%', inline: true },
      { name: '📈 Progress Server', value: progressBar(s.points, sNext) }
    );
  }

  return new EmbedBuilder()
    .setTitle('🃏 Profil — ' + user.username)
    .setColor(0xFF6B35)
    .setThumbnail(user.displayAvatarURL())
    .addFields(fields);
}


function leaderboardEmbed(board, isServer = false, serverName = '') {
  const medals = ['🥇', '🥈', '🥉'];
  const rows = board.map((p, i) => {
    const wr = p.games_played > 0 ? ((p.wins / p.games_played) * 100).toFixed(0) : '0';
    const medal = medals[i] || ('**' + (i+1) + '.**');
    return medal + ' **' + p.username + '** — ' + p.points.toLocaleString() + ' pts ' + getRank(p.points).name + '\n　🏆 ' + p.wins + ' menang | 🎮 ' + p.games_played + ' game | ' + wr + '% WR';
  }).join('\n\n');

  const title = isServer
    ? '🏠 Leaderboard Server' + (serverName ? ' — ' + serverName : '')
    : '🌍 Leaderboard Global';

  const footer = isServer
    ? 'Gunakan !uno top global untuk leaderboard global'
    : 'Gunakan !uno top untuk leaderboard server';

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(isServer ? '#4488FF' : '#FFD700')
    .setDescription(rows || 'Belum ada data.')
    .addFields({ name: '⭐ Sistem Poin', value: '🏆 Menang +100 | 🃏 nilai kartu sisa | 🔴 UNO +20 | 👤 Main +10' })
    .setFooter({ text: footer })
    .setTimestamp();
}

function helpEmbed() {
  return new EmbedBuilder()
    .setTitle('🃏 UNO Bot — Panduan')
    .setColor('#FF6B35')
    .addFields(
      { name: '🟢 Game', value: '`!uno start` — mulai game\n`!uno solo` — lawan bot AI\n`!uno join` `!uno hand` `!uno leave` `!uno stop`' },
      { name: '🏆 Ranking', value: '`!uno rank` — profil kamu\n`!uno rank @user` — profil orang lain\n`!uno leaderboard` / `!uno top` — top 10' },
      { name: '⭐ Poin', value: '🏆 Menang: **+100**\n🃏 +5 per kartu sisa lawan\n🔴 UNO bonus: **+20**\n👤 Ikut main: **+10**' },
      { name: '🎖️ Rank', value: '🥉 Pemula → ⚔️ Petarung → 🥈 Ahli → 🥇 Master → 💎 Legend → 👑 UNO King' }
    );
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('❌ Set DISCORD_TOKEN di file .env'); process.exit(1); }

// ── Global error handler — biar bot tidak crash karena error kecil ──
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled rejection (ditangkap, bot tetap jalan):', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught exception (ditangkap, bot tetap jalan):', err?.message || err);
});
client.on('error', (err) => {
  console.error('⚠️ Discord client error:', err?.message || err);
});

// Inisialisasi database dulu, baru login
initDb()
  .then(() => {
    console.log('✅ Database siap!');
    return client.login(TOKEN);
  })
  .catch(err => {
    console.error('❌ Gagal inisialisasi:', err);
    process.exit(1);
  });
