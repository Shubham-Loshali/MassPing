/**
 * Bulk WhatsApp Sender (text + photo / document / video)
 * Standalone project. Reads numbers.txt and keeps its WhatsApp login in .wwebjs_auth.
 * No group adding. Open http://localhost:3000, type the message, attach files, Send.
 */
// Apply media-sending fix BEFORE whatsapp-web.js is loaded
require('./patch-wwebjs').apply();

const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// ---------- Settings ----------
const PORT = 3000;
const NUMBERS_FILE = 'numbers.txt';
const PROGRESS_FILE = 'bulk-progress.json';
const REPORT_FILE = 'bulk-report.txt';
const DEFAULT_COUNTRY_CODE = '91';   // prepended to 10-digit numbers
const LONG_PAUSE_EVERY = 25;         // extra rest after every N sends
const LONG_PAUSE_SEC = [45, 90];     // random rest range (seconds)
// ------------------------------

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 64 * 1024 * 1024 } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

const wa = { status: 'starting', qr: null, error: null };
const job = { running: false, stop: false, total: 0, sent: 0, failed: 0, skipped: 0, log: [] };

function log(msg) {
  const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  console.log(line);
  job.log.push(line);
  if (job.log.length > 500) job.log.shift();
}

function normalizeNumbers(text) {
  const seen = new Set();
  const out = [];
  for (let raw of String(text || '').split(/[\s,;]+/)) {
    let n = raw.replace(/\D/g, '');
    if (!n) continue;
    if (n.length === 10) n = DEFAULT_COUNTRY_CODE + n;
    if (n.length < 8 || n.length > 15) continue;
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

const loadProgress = () => {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return {}; }
};
const saveProgress = (p) => fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));

// ---------- WhatsApp client ----------
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
});
client.on('qr', async (qr) => { wa.status = 'qr'; wa.qr = await QRCode.toDataURL(qr, { width: 280 }); });
client.on('authenticated', () => { wa.status = 'authenticated'; wa.qr = null; });
client.on('ready', () => { wa.status = 'ready'; wa.qr = null; console.log('WhatsApp ready'); });
client.on('auth_failure', (m) => { wa.status = 'error'; wa.error = 'Auth failed: ' + m; });
client.on('disconnected', (r) => { wa.status = 'disconnected'; wa.error = String(r); });
client.initialize().catch((e) => { wa.status = 'error'; wa.error = e.message; });

// ---------- Sending job ----------
async function runJob({ message, numbers, files, minD, maxD, asDoc, dry, skipDone }) {
  job.running = true; job.stop = false;
  job.total = numbers.length; job.sent = 0; job.failed = 0; job.skipped = 0; job.log = [];

  const progress = skipDone ? loadProgress() : {};
  const medias = files.map(
    (f) => new MessageMedia(f.mimetype, fs.readFileSync(f.path).toString('base64'), f.originalname)
  );
  log('Starting: ' + numbers.length + ' numbers, ' + medias.length + ' attachment(s)' + (dry ? ' [DRY RUN]' : ''));

  let sentSinceRest = 0;
  for (let i = 0; i < numbers.length; i++) {
    if (job.stop) { log('Stopped by user.'); break; }
    const num = numbers[i];
    if (progress[num] === 'sent') { job.skipped++; log(num + ' skipped (already sent)'); continue; }

    let didSend = false;
    try {
      if (dry) {
        log('(dry) would send to ' + num);
        job.sent++;
      } else {
        // 1) Resolve the chat id. If the lookup itself breaks (known issue on old
        //    whatsapp-web.js versions), fall back to the plain number@c.us id.
        let chatId = null, notOnWA = false;
        try {
          const id = await client.getNumberId(num);
          if (id) chatId = id._serialized; else notOnWA = true;
        } catch (e) {
          log(num + ' lookup failed (' + e.message.slice(0, 60) + '...), trying direct send');
          chatId = num + '@c.us';
        }

        if (notOnWA) {
          progress[num] = 'not_on_whatsapp'; job.failed++;
          log(num + ' not on WhatsApp');
        } else {
          // 2) Send
          try {
            if (medias.length === 0) {
              await client.sendMessage(chatId, message, { sendSeen: false });
            } else {
              for (let m = 0; m < medias.length; m++) {
                await client.sendMessage(chatId, medias[m], {
                  caption: m === 0 && message ? message : undefined,
                  sendMediaAsDocument: asDoc,
                  sendSeen: false,
                });
                if (m < medias.length - 1) await sleep(rand(1000, 2000));
              }
            }
          } catch (e) {
            throw new Error('send step: ' + e.message);
          }
          progress[num] = 'sent'; job.sent++; didSend = true; sentSinceRest++;
          log(num + ' sent (' + (i + 1) + '/' + numbers.length + ')');
        }
        saveProgress(progress);
      }
    } catch (e) {
      progress[num] = 'failed: ' + e.message; job.failed++;
      log(num + ' FAILED: ' + e.message);
      if (!dry) saveProgress(progress);
    }

    if (i < numbers.length - 1 && !job.stop && (didSend || dry)) {
      let wait = rand(minD, maxD);
      if (!dry && sentSinceRest >= LONG_PAUSE_EVERY) {
        wait += rand(LONG_PAUSE_SEC[0], LONG_PAUSE_SEC[1]);
        sentSinceRest = 0;
        log('Resting a bit to look human...');
      }
      await sleep(wait * 1000);
    }
  }

  const report = [
    'Bulk send report - ' + new Date().toLocaleString(),
    'Sent: ' + job.sent + '  Failed: ' + job.failed + '  Skipped: ' + job.skipped + '  Total: ' + job.total,
    '',
    ...Object.entries(progress).filter(([, v]) => v !== 'sent').map(([n, v]) => n + ' -> ' + v),
  ].join('\n');
  fs.writeFileSync(REPORT_FILE, report);
  log('Done. Sent ' + job.sent + ', failed ' + job.failed + ', skipped ' + job.skipped + '. Report: ' + REPORT_FILE);

  files.forEach((f) => fs.unlink(f.path, () => {}));
  job.running = false;
}

// ---------- Web UI ----------
const app = express();
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'ui.html')));

app.get('/status', (_req, res) => {
  let numbersText = '';
  try { numbersText = fs.readFileSync(NUMBERS_FILE, 'utf8'); } catch {}
  res.json({ wa, job, numbersText });
});

app.post('/send', upload.array('files', 10), (req, res) => {
  if (wa.status !== 'ready') return res.status(400).json({ error: 'WhatsApp is not connected yet.' });
  if (job.running) return res.status(400).json({ error: 'A send is already running.' });

  const message = (req.body.message || '').trim();
  const files = req.files || [];
  const numbers = normalizeNumbers(req.body.numbers);
  if (!message && files.length === 0) return res.status(400).json({ error: 'Type a message or attach a file.' });
  if (numbers.length === 0) return res.status(400).json({ error: 'No valid numbers.' });

  let minD = Math.max(1, parseFloat(req.body.minDelay) || 5);
  let maxD = Math.max(minD, parseFloat(req.body.maxDelay) || 10);

  runJob({
    message, numbers, files, minD, maxD,
    asDoc: req.body.asDocument === 'true',
    dry: req.body.dryRun === 'true',
    skipDone: req.body.skipDone === 'true',
  }).catch((e) => { log('Fatal: ' + e.message); job.running = false; });

  res.json({ ok: true, count: numbers.length });
});

app.post('/stop', (_req, res) => { job.stop = true; res.json({ ok: true }); });

app.listen(PORT, () => console.log('Open http://localhost:' + PORT));
