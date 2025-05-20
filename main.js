const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('baileys');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

// ====== 1. MongoDB Connection ======
require('dotenv').config();
mongoose.connect(process.env.MONGO, {
    serverSelectionTimeoutMS: 10000,
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => console.error("❌ MongoDB connection failed:", err.message));

// ====== 2. Group Settings Schema ======
const groupSettingsSchema = new mongoose.Schema({
    groupId: { type: String, required: true },
    antiLink: { type: Boolean, default: true }
});

const GroupSettings = mongoose.model('GroupSettings', groupSettingsSchema);

// ====== 3. Bot Auth + Setup ======
async function authenticateBot() {
    const sessionDir = path.join(__dirname, 'session');
    const credsPath = path.join(sessionDir, 'creds.json');

    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const Bloom = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true
    });

Bloom.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
            console.log('⚠️ Reconnecting...');
            authenticateBot();
        }
    } else if (connection === 'open') {
        console.log('✅ Bot is online');
    } else if (connection === 'qr') {
        console.log('📱 Scan the QR code below to log in:');
        console.log(qr);  // Log the QR code to the terminal
    }
});

    Bloom.ev.on('creds.update', saveCreds);
    return Bloom;
}

// ====== 4. Check Admin ======
async function checkIfAdmin(Bloom, sender, groupId) {
    const group = await Bloom.groupMetadata(groupId);
    const participant = group.participants.find(p => p.id === sender);
    return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
}

// ====== 5. Handle Anti-Link Logic ======
async function handleIncomingMessages(Bloom, message) {
    if (!message || !message.message || message.key.fromMe) return;

    const groupId = message.key.remoteJid;
    if (!groupId.endsWith('@g.us')) return;

    const sender = message.key.participant;
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';

    // Fetch group settings
    let settings = await GroupSettings.findOne({ groupId });
    if (!settings) {
        settings = new GroupSettings({ groupId });
        await settings.save();
    }

    // Anti-link logic
    const linkRegex = /(?:https?:\/\/|www\.)[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?/gi;
    if (settings.antiLink && linkRegex.test(text)) {
        const isAdmin = await checkIfAdmin(Bloom, sender, groupId);
        if (!isAdmin) {
            await Bloom.sendMessage(groupId, { text: `🚫 Link detected, removing @${sender.split('@')[0]}`, mentions: [sender] });
            await Bloom.sendMessage(groupId, { delete: message.key });
            await Bloom.groupParticipantsUpdate(groupId, [sender], 'remove');
        }
    }
}

// ====== 6. Toggle Anti-Link Commands ======
async function handleCommands(Bloom, message) {
    const groupId = message.key.remoteJid;
    if (!groupId.endsWith('@g.us')) return;

    const sender = message.key.participant;
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';

    const isAdmin = await checkIfAdmin(Bloom, sender, groupId);
    if (!isAdmin) return;

    if (text.toLowerCase() === '!antilink on') {
        await GroupSettings.findOneAndUpdate(
            { groupId },
            { $set: { antiLink: true } },
            { upsert: true }
        );
        await Bloom.sendMessage(groupId, { text: '✅ Anti-link has been *enabled*.' });
    }

    if (text.toLowerCase() === '!antilink off') {
        await GroupSettings.findOneAndUpdate(
            { groupId },
            { $set: { antiLink: false } },
            { upsert: true }
        );
        await Bloom.sendMessage(groupId, { text: '❌ Anti-link has been *disabled*.' });
    }
}

// ====== 7. Main Message Handler ======
async function startBot() {
    const Bloom = await authenticateBot();

    Bloom.ev.on('messages.upsert', async (chatUpdate) => {
        const message = chatUpdate.messages?.[0];
        if (!message || !message.message) return;

        await handleIncomingMessages(Bloom, message);
        await handleCommands(Bloom, message);
    });
}

// ====== 8. Start Everything ======
startBot();
