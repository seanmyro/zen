require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios'); // Added for GitHub API

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const app = express();
app.use(express.json());

const KEYS_FILE = path.join(__dirname, 'keys.json');
const AUTH_FILE = path.join(__dirname, 'auth_users.json');

// Hardcoded authorized user IDs
const PRE_AUTHORIZED_USERS = ['1476771914751017163', '1498853751354560634'];

// --- GitHub Sync Helper ---
async function syncKeysToGitHub(keysData) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    console.log('⚠ Skipping GitHub sync: GITHUB_TOKEN is not set in environment variables.');
    return;
  }

  const REPO_OWNER = 'seanmyro';
  const REPO_NAME = 'zen';
  const FILE_PATH = 'keys.json';
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;

  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'User-Agent': 'zen-bot',
    'Accept': 'application/vnd.github+json'
  };

  try {
    // 1. Get current file SHA hash from GitHub
    const getRes = await axios.get(url, { headers });
    const currentSha = getRes.data.sha;

    // 2. Extract key strings into array format: ["ZEN-XXX", "ZEN-YYY"]
    const keyArray = Object.keys(keysData);
    const updatedContent = Buffer.from(JSON.stringify(keyArray, null, 2)).toString('base64');

    // 3. Push updated array back to GitHub
    await axios.put(url, {
      message: 'Bot auto-updated keys.json',
      content: updatedContent,
      sha: currentSha
    }, { headers });

    console.log('✅ Successfully synced keys.json to GitHub!');
  } catch (error) {
    console.error('❌ GitHub Sync Error:', error.response ? error.response.data : error.message);
  }
}

// --- File Handling ---
function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) {
    fs.writeFileSync(KEYS_FILE, JSON.stringify({}, null, 2));
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveKeys(keysData) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keysData, null, 2));
  // Auto-sync to GitHub whenever keys file is saved
  syncKeysToGitHub(keysData);
}

function loadAuthUsers() {
  if (!fs.existsSync(AUTH_FILE)) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(PRE_AUTHORIZED_USERS, null, 2));
  }
  try {
    const loaded = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return Array.from(new Set([...PRE_AUTHORIZED_USERS, ...loaded]));
  } catch (err) {
    return [...PRE_AUTHORIZED_USERS];
  }
}

function saveAuthUsers(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

// --- Duration Parser & Expiration Helpers ---
function parseDuration(input) {
  let str = '';
  
  if (typeof input === 'object' && input !== null) {
    const dataObj = input.data || input;

    const parts = [
      dataObj.product_name,
      dataObj.variant_name,
      dataObj.duration,
      dataObj.product?.name,
      dataObj.product?.title,
      dataObj.variant?.name,
      dataObj.variant?.title,
      dataObj.title,
      JSON.stringify(input)
    ].filter(Boolean);
    str = parts.join(' ').toLowerCase();
  } else {
    str = (input || '').toLowerCase();
  }

  if (str.includes('lifetime') || str.includes('life time') || str.includes('forever') || str.includes('perm')) {
    return { label: 'Lifetime', durationDays: null, isLifetime: true };
  }
  if (str.includes('year') || str.includes('1y') || str.includes('365d') || str.includes('1 year')) {
    return { label: '1 Year', durationDays: 365, isLifetime: false };
  }
  if (str.includes('month') || str.includes('1m') || str.includes('30d') || str.includes('1 month')) {
    return { label: '1 Month', durationDays: 30, isLifetime: false };
  }
  if (str.includes('week') || str.includes('1w') || str.includes('7d') || str.includes('1 week')) {
    return { label: '1 Week', durationDays: 7, isLifetime: false };
  }
  if (str.includes('day') || str.includes('1d') || str.includes('24h') || str.includes('1 day')) {
    return { label: '1 Day', durationDays: 1, isLifetime: false };
  }

  return { label: '1 Day', durationDays: 1, isLifetime: false };
}

app.get('/', (req, res) => {
  res.send('Z E N Bot Operational.');
});

client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Deploy the Z E N panel embed')
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('Registering /setup command...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Slash commands registered successfully!');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
});

const DOWNLOAD_URL = (() => {
  const raw = (process.env.DOWNLOAD_URL || '').trim();
  if (!raw) return 'https://example.com';
  try {
    return new URL(raw).toString();
  } catch {
    try {
      return new URL(`https://${raw}`).toString();
    } catch {
      return 'https://example.com';
    }
  }
})();

client.on('error', (err) => console.error('Client error:', err));

// --- Chat Message Handlers ---
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.toLowerCase().trim();
  const rawContent = message.content.trim();
  const authUsers = loadAuthUsers();

  const isServerOwner = message.guild.ownerId === message.author.id;
  const isAuthUser = authUsers.includes(message.author.id) || isServerOwner;

  // 1. Authorization Command: !add <user_id or @mention>
  if (content.startsWith('!add')) {
    if (!isAuthUser) return;
    try {
      const targetUser = message.mentions.users.first();
      const args = rawContent.split(' ').slice(1);
      const targetId = targetUser ? targetUser.id : args[0]?.replace(/[<@!>]/g, '');

      if (!targetId || isNaN(targetId)) {
        return message.reply('❌ Usage: `!add <UserID>` or `!add @user`');
      }
      if (authUsers.includes(targetId)) {
        return message.reply(`⚠ User <@${targetId}> is already authorized.`);
      }

      authUsers.push(targetId);
      saveAuthUsers(authUsers);

      const embed = new EmbedBuilder()
        .setTitle('✅ Authorization Granted')
        .setColor('#00FF7F')
        .setDescription(`User <@${targetId}> (\`${targetId}\`) has been granted permission to use bot commands.`)
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    } catch (err) { console.error(err); }
    return;
  }

  // ALL COMMANDS BELOW REQUIRE AUTHORIZATION
  if (!isAuthUser) return;

  // 2. Key Revocation Command: !revoke <key>
  if (content.startsWith('!revoke')) {
    try {
      const args = rawContent.split(' ').slice(1);
      const targetKey = args[0]?.toUpperCase().trim();

      if (!targetKey) {
        return message.reply('❌ Usage: `!revoke ZEN-XXXX-XXXX`');
      }

      const keysData = loadKeys();
      if (!keysData[targetKey]) {
        return message.reply(`❌ Key \`${targetKey}\` was not found.`);
      }

      delete keysData[targetKey];
      saveKeys(keysData);

      const embed = new EmbedBuilder()
        .setTitle('🚫 Key Revoked')
        .setColor('#FF0033')
        .setDescription(`License key \`${targetKey}\` has been successfully revoked and removed from GitHub.`)
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    } catch (err) { console.error(err); }
    return;
  }

  // 3. !setup Prefix Command
  if (content === '!setup') {
    const embed = new EmbedBuilder()
      .setTitle('Z E N')
      .setColor('#00FF7F');

    const downloadBtn = new ButtonBuilder()
      .setLabel('Download')
      .setStyle(ButtonStyle.Link)
      .setURL(DOWNLOAD_URL);

    const resetHwidBtn = new ButtonBuilder()
      .setCustomId('reset_hwid_btn')
      .setLabel('Reset HWID / Redeem')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⚙️');

    const row = new ActionRowBuilder().addComponents(downloadBtn, resetHwidBtn);

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
    return;
  }

  // 4. Manual Key Generation Handler
  if (content.startsWith('gen key') || content.startsWith('generate key') || content.includes('gen key') || content.startsWith('!gen')) {
    const durationData = parseDuration(rawContent);
    const generatedKey = `ZEN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const createdAt = new Date().toISOString();

    const keysData = loadKeys();
    keysData[generatedKey] = {
      product: 'Manual Generation',
      duration: durationData.label,
      durationDays: durationData.durationDays,
      createdAt: createdAt,
      expiresAt: null,
      isLifetime: durationData.isLifetime,
      redeemed: false,
      redeemedBy: null,
      redeemedAt: null
    };
    saveKeys(keysData);

    const embed = new EmbedBuilder()
      .setTitle('🔑 Manual Key Generated')
      .setColor('#00FF7F')
      .addFields(
        { name: '⏳ Duration', value: `\`${durationData.label}\``, inline: true },
        { name: '⏰ Expiration Date', value: `\`Timer starts upon redemption (${durationData.label})\``, inline: false },
        { name: '🔑 License Key', value: `\`\`\`${generatedKey}\`\`\``, inline: false }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
});

// --- Slash Commands, Buttons, & Modals ---
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setup') {
      const authUsers = loadAuthUsers();
      const isServerOwner = interaction.guild?.ownerId === interaction.user.id;
      if (!authUsers.includes(interaction.user.id) && !isServerOwner) {
        return interaction.reply({ content: '❌ You are not authorized to use this command.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('Z E N')
        .setColor('#00FF7F');

      const downloadBtn = new ButtonBuilder()
        .setLabel('Download')
        .setStyle(ButtonStyle.Link)
        .setURL(DOWNLOAD_URL);

      const resetHwidBtn = new ButtonBuilder()
        .setCustomId('reset_hwid_btn')
        .setLabel('Reset HWID / Redeem')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⚙️');

      const row = new ActionRowBuilder().addComponents(downloadBtn, resetHwidBtn);
      await interaction.reply({ embeds: [embed], components: [row] });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'reset_hwid_btn') {
      const modal = new ModalBuilder()
        .setCustomId('reset_hwid_modal')
        .setTitle('Redeem Key / Reset HWID');

      const keyInput = new TextInputBuilder()
        .setCustomId('hwid_key_input')
        .setLabel('License Key')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter your license key here')
        .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(keyInput);
      modal.addComponents(actionRow);
      await interaction.showModal(modal);
    }
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === 'reset_hwid_modal') {
      const userKey = interaction.fields.getTextInputValue('hwid_key_input').trim();
      const keysData = loadKeys();
      const keyObj = keysData[userKey];

      if (!keyObj) {
        return interaction.reply({
          content: `❌ **Invalid Key!** The key \`${userKey}\` was not found.`,
          ephemeral: true
        });
      }

      const now = new Date();
      if (!keyObj.redeemed || !keyObj.expiresAt) {
        keyObj.redeemed = true;
        keyObj.redeemedBy = `${interaction.user.tag} (${interaction.user.id})`;
        keyObj.redeemedAt = now.toISOString();

        if (keyObj.isLifetime || keyObj.durationDays === null || keyObj.duration === 'Lifetime') {
          keyObj.expiresAt = 'Never';
          keyObj.isLifetime = true;
        } else {
          const days = keyObj.durationDays || 30;
          const expireDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
          keyObj.expiresAt = expireDate.toISOString();
        }

        saveKeys(keysData);

        try {
          const manualLogChannelId = process.env.CHANNEL_ID || '1554325937728790619';
          const logChannel = await client.channels.fetch(manualLogChannelId);
          if (logChannel) {
            const expTimestamp = keyObj.isLifetime ? 'Never' : `<t:${Math.floor(new Date(keyObj.expiresAt).getTime() / 1000)}:F>`;
            const redeemEmbed = new EmbedBuilder()
              .setTitle('🔓 Key Redeemed / HWID Reset!')
              .setColor('#FFD700')
              .addFields(
                { name: '🔑 Key', value: `\`${userKey}\``, inline: true },
                { name: '👤 Redeemed By', value: `<@${interaction.user.id}>`, inline: true },
                { name: '⏱️ Duration', value: `\`${keyObj.duration}\``, inline: true },
                { name: '⏰ Expires At', value: expTimestamp, inline: false }
              )
              .setTimestamp();
            await logChannel.send({ embeds: [redeemEmbed] });
          }
        } catch (e) { console.error('Failed to log redemption:', e); }
      }

      const expirationString = keyObj.isLifetime 
        ? 'Never (Lifetime)' 
        : `<t:${Math.floor(new Date(keyObj.expiresAt).getTime() / 1000)}:F> (<t:${Math.floor(new Date(keyObj.expiresAt).getTime() / 1000)}:R>)`;

      await interaction.reply({
        content: 
          `✅ **Key Verified & HWID Reset!**\n\n` +
          `🔑 **Key:** \`${userKey}\`\n` +
          `⏳ **Duration:** ${keyObj.duration}\n` +
          `📅 **Redeemed:** <t:${Math.floor(new Date(keyObj.redeemedAt).getTime() / 1000)}:R>\n` +
          `⏰ **Expires:** ${expirationString}\n\n` +
          `*Status: Active / Redeemed*`,
        ephemeral: true
      });
    }
  }
});

// --- SellAuth Webhook Endpoint ---
app.post('/webhook/sellauth', async (req, res) => {
  try {
    const payload = req.body || {};
    const durationData = parseDuration(payload);

    const generatedKey = `ZEN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const createdAt = new Date().toISOString();

    const dataObj = payload.data || payload;
    const productName = dataObj.product_name || dataObj.product?.name || dataObj.product?.title || 'Z E N Enhancement';

    const keysData = loadKeys();
    keysData[generatedKey] = {
      product: productName,
      duration: durationData.label,
      durationDays: durationData.durationDays,
      createdAt: createdAt,
      expiresAt: null,
      isLifetime: durationData.isLifetime,
      redeemed: false,
      redeemedBy: null,
      redeemedAt: null
    };
    saveKeys(keysData);

    res.status(200).send(generatedKey);

    const purchaseChannelId = process.env.PURCHASE_CHANNEL_ID || '1553943678014333090';

    const channel = await client.channels.fetch(purchaseChannelId).catch(() => null);
    if (channel) {
      const embed = new EmbedBuilder()
        .setTitle('🛒 New Purchase — Key Created!')
        .setColor('#00FF7F')
        .addFields(
          { name: '📦 Product', value: `${keysData[generatedKey].product}`, inline: true },
          { name: '⏳ Duration', value: `\`${durationData.label}\``, inline: true },
          { name: '⏰ Expiration Date', value: `\`Timer starts upon redemption (${durationData.label})\``, inline: false },
          { name: '🔑 Generated Key', value: `\`\`\`${generatedKey}\`\`\``, inline: false }
        )
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    if (!res.headersSent) {
      res.status(500).send('Webhook Processing Error');
    }
  }
});

// --- API Endpoint for EXE Key Verification ---
app.post('/api/verify-key', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ success: false, message: 'Key required' });

  const keysData = loadKeys();
  const keyObj = keysData[key];

  if (!keyObj) {
    return res.status(404).json({ success: false, message: 'Invalid Key' });
  }

  if (!keyObj.redeemed) {
    return res.status(403).json({ success: false, message: 'Key not redeemed yet. Redeem in Discord first.' });
  }

  const isExpired = !keyObj.isLifetime && (new Date() > new Date(keyObj.expiresAt));

  if (isExpired) {
    return res.status(403).json({ success: false, message: 'Key Expired' });
  }

  res.json({
    success: true,
    key: key,
    duration: keyObj.duration,
    expiresAt: keyObj.expiresAt,
    isLifetime: keyObj.isLifetime,
    redeemed: keyObj.redeemed
  });
});

const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
