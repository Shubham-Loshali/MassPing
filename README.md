# Bulk Sender

Send one message (with optional photo / video / PDF / any file) to many WhatsApp numbers.
No group adding. Type the message, attach files, click Send.

## Setup
1. Install Node.js 18 or newer.
2. In this folder run:
   ```
   npm install
   ```
3. Put your numbers in `numbers.txt` (one per line, with country code, digits only).
   10-digit numbers automatically get `91` added.

## Run
```
npm start
```
Open http://localhost:3000

- First time: scan the QR code shown on the page (WhatsApp -> Linked Devices -> Link a Device).
- Type your message, attach files if needed, edit numbers if needed, click Send.
- Tick "Dry run" to test without sending anything.
- Tick "Skip numbers already sent" to resume an interrupted run.
- Results are saved in `bulk-report.txt`.

## Tips to avoid a ban
- Only message people who agreed to hear from you.
- Keep delays at 5-10 sec or more, send ~100-200 per day, test on your own numbers first.

## Log out / switch account
Delete the `.wwebjs_auth` folder.

## Linux / WSL
If Chrome/Puppeteer errors appear, install Chromium libraries:
```
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2
```

## If you see: "Data passed to getter must include an id property"
This is a known whatsapp-web.js bug that breaks sending photos/videos/documents (text still works).
`patch-wwebjs.js` fixes it automatically after `npm install` and every time you run `npm start`.
If you still see it: delete `node_modules`, run `npm install` again, then delete `.wwebjs_auth` and `.wwebjs_cache`, run `npm start` and scan the QR once more.

## Files
- `index.js`  server + sending logic
- `patch-wwebjs.js`  auto-fix for the media bug
- `ui.html`  the web page
- `numbers.txt`  recipient list
- `package.json`  dependencies
