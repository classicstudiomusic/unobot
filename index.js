require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { UnoGame } = require('./game');
const { initDb, recordGameEnd, getLeaderboard, getPlayerStats, ensurePlayer, getRank, getNextRank } = require('./db');

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
  client.user.setActivity('🃏 UNO by Lx (CLASSIC STUDIO LAB)| !uno help');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

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
      ensurePlayer(message.author.id, message.author.username);
      return message.channel.send({ embeds: [game.lobbyEmbed()], components: [game.lobbyButtons()] });
    }

    if (sub === 'join') {
      const game = games.get(channelId);
      if (!game) return message.reply('❌ Tidak ada game. Gunakan `!uno start`.');
      if (game.started) return message.reply('❌ Game sudah berjalan!');
      if (game.hasPlayer(message.author.id)) return message.reply('❌ Kamu sudah join!');
      if (game.players.length >= 10) return message.reply('❌ Game penuh!');
      game.addPlayer(message.author);
      ensurePlayer(message.author.id, message.author.username);
      return message.channel.send({ embeds: [game.lobbyEmbed()], components: [game.lobbyButtons()] });
    }

    if (sub === 'leave') {
      const game = games.get(channelId);
      if (!game) return message.reply('❌ Tidak ada game.');
      if (!game.hasPlayer(message.author.id)) return message.reply('❌ Kamu tidak dalam game ini.');

      const leavingName = message.author.username;
      game.removePlayer(message.author.id);

      // Kalau game belum mulai
      if (!game.started) {
        if (game.players.length === 0) { games.delete(channelId); return message.channel.send('🗑️ Game dibatalkan.'); }
        return message.channel.send(`👋 **${leavingName}** keluar dari lobby.`);
      }

      // Kalau game sudah berjalan
      await message.channel.send(`🚪 **${leavingName}** keluar dari game!`);

      // Kalau tinggal 1 pemain → menang otomatis
      if (game.players.length === 1) {
        const winner = game.players[0];
        const pts = recordGameEnd(winner, [...game.players, { id: message.author.id, name: leavingName, hand: [], saidUno: false }]);
        games.delete(channelId);
        return message.channel.send({ embeds: [winEmbed(winner, pts, true)] });
      }

      // Kalau tinggal 0 (semua leave)
      if (game.players.length === 0) {
        games.delete(channelId);
        return message.channel.send('🗑️ Semua pemain keluar. Game berakhir.');
      }

      // Kalau yang leave adalah giliran sekarang, skip ke berikutnya
      if (game.currentIndex >= game.players.length) {
        game.currentIndex = 0;
      }

      return sendGameState(game, message.channel);
    }

    if (sub === 'stop') {
      if (!games.has(channelId)) return message.reply('❌ Tidak ada game aktif.');
      games.delete(channelId);
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
      const stats = getPlayerStats(target.id);
      if (!stats) return message.channel.send(`❌ **${target.username}** belum pernah main UNO!`);
      return message.channel.send({ embeds: [profileEmbed(stats, target)] });
    }

    if (sub === 'leaderboard' || sub === 'lb' || sub === 'top') {
      return message.channel.send({ embeds: [leaderboardEmbed(getLeaderboard(10))] });
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  const channelId = interaction.channelId;
  const game = games.get(channelId);

  if (interaction.isButton()) {
    const id = interaction.customId;

    if (id === 'uno_begin') {
      if (!game) return interaction.reply({ content: '❌ Game tidak ditemukan.', ephemeral: true });
      if (game.players[0].id !== interaction.user.id) return interaction.reply({ content: '❌ Hanya host!', ephemeral: true });
      if (game.players.length < 2) return interaction.reply({ content: '❌ Minimal 2 pemain!', ephemeral: true });
      await game.startGame();
      await interaction.update({ embeds: [game.lobbyEmbed()], components: [] });
      return sendGameState(game, interaction.channel);
    }

    if (id === 'uno_draw') {
      if (!game?.started) return interaction.reply({ content: '❌ Tidak ada game aktif.', ephemeral: true });
      const cur = game.getCurrentPlayer();
      if (interaction.user.id !== cur.id) return interaction.reply({ content: '❌ Bukan giliran kamu!', ephemeral: true });
      const drawn = game.drawCard(cur);
      await interaction.reply({ content: `🃏 Kamu ambil: **${drawn.toString()}**`, ephemeral: true });
      await interaction.channel.send(`🎲 **${cur.name}** mengambil 1 kartu.`);
      game.nextTurn();
      return sendGameState(game, interaction.channel);
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
      if (!playable.length) return interaction.reply({ content: '❌ Tidak ada kartu yang bisa dimainkan!', ephemeral: true });
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
        const pts = recordGameEnd(result.winner, game.players);
        games.delete(channelId);
        return interaction.channel.send({ embeds: [winEmbed(result.winner, pts)] });
      }
      return sendGameState(game, interaction.channel);
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
      const pts = recordGameEnd(result.winner, game.players);
      games.delete(channelId);
      return interaction.channel.send({ embeds: [winEmbed(result.winner, pts)] });
    }
    return sendGameState(game, interaction.channel);
  }
});

async function sendGameState(game, channel) {
  await channel.send({ embeds: [game.gameStateEmbed()], components: [game.gameButtons()] });
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

function profileEmbed(stats, user) {
  const rank = getRank(stats.points);
  const next = getNextRank(stats.points);
  const winRate = stats.games_played > 0 ? ((stats.wins / stats.games_played) * 100).toFixed(1) : '0';
  let bar = '';
  if (next) {
    const ranks = [0, 200, 500, 1000, 2000, 5000];
    const prevMin = ranks.filter(r => r <= stats.points && r < next.min).pop() || 0;
    const filled = Math.min(10, Math.floor(((stats.points - prevMin) / (next.min - prevMin)) * 10));
    bar = `\`[${'█'.repeat(filled)}${'░'.repeat(10-filled)}]\` ${stats.points}/${next.min} pts`;
  }
  return new EmbedBuilder()
    .setTitle(`🃏 Profil — ${user.username}`)
    .setColor(0xFF6B35)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: '🏅 Rank', value: rank.name, inline: true },
      { name: '⭐ Total Poin', value: `${stats.points.toLocaleString()} pts`, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '🏆 Menang', value: `${stats.wins}`, inline: true },
      { name: '🎮 Total Game', value: `${stats.games_played}`, inline: true },
      { name: '📊 Win Rate', value: `${winRate}%`, inline: true },
      ...(next ? [{ name: `📈 Menuju ${next.name}`, value: bar }] : [{ name: '👑', value: 'Rank Tertinggi!' }])
    );
}

function leaderboardEmbed(board) {
  const medals = ['🥇', '🥈', '🥉'];
  const rows = board.map((p, i) => {
    const wr = p.games_played > 0 ? ((p.wins / p.games_played) * 100).toFixed(0) : '0';
    return `${medals[i] || `**${i+1}.**`} **${p.username}** — ${p.points.toLocaleString()} pts ${getRank(p.points).name}\n　🏆 ${p.wins} menang | 🎮 ${p.games_played} game | ${wr}% WR`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setTitle('🏆 Leaderboard UNO')
    .setColor('#FFD700')
    .setDescription(rows || 'Belum ada data.')
    .addFields({ name: '⭐ Sistem Poin', value: '🏆 Menang +100 | 🃏 +5/kartu sisa | 🔴 UNO +20 | 👤 Ikut main +10' })
    .setTimestamp();
}

function helpEmbed() {
  return new EmbedBuilder()
    .setTitle('🃏 UNO Bot — Panduan')
    .setColor('#FF6B35')
    .addFields(
      { name: '🟢 Game', value: '`!uno start` `!uno join` `!uno hand` `!uno leave` `!uno stop`' },
      { name: '🏆 Ranking', value: '`!uno rank` — profil kamu\n`!uno rank @user` — profil orang lain\n`!uno leaderboard` / `!uno top` — top 10' },
      { name: '⭐ Poin', value: '🏆 Menang: **+100**\n🃏 +5 per kartu sisa lawan\n🔴 UNO bonus: **+20**\n👤 Ikut main: **+10**' },
      { name: '🎖️ Rank', value: '🥉 Pemula → ⚔️ Petarung → 🥈 Ahli → 🥇 Master → 💎 Legend → 👑 UNO King' }
    );
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) { console.error('❌ Set DISCORD_TOKEN di file .env'); process.exit(1); }

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
