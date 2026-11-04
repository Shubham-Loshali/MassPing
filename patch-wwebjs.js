/**
 * Fixes the whatsapp-web.js media bug:
 *   "Data passed to getter must include an id property (it's how we memoize) but got undefined"
 * (text works, photos/videos/documents fail). Fix = delete message.__x_id before WhatsApp builds the Msg.
 * Runs automatically after `npm install` and every time the app starts. Safe to run many times.
 */
const fs = require('fs');
const path = require('path');

function findUtilsFile() {
  const rels = [path.join('src', 'util', 'Injected', 'Utils.js')];
  const roots = [];
  try { roots.push(path.dirname(require.resolve('whatsapp-web.js'))); } catch {}
  roots.push(path.join(__dirname, 'node_modules', 'whatsapp-web.js'));
  for (const root of roots) {
    for (const rel of rels) {
      const f = path.join(root, rel);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

function apply(quiet) {
  const say = (m) => { if (!quiet) console.log('[patch] ' + m); };
  const file = findUtilsFile();
  if (!file) { say('whatsapp-web.js not found yet (run npm install).'); return false; }

  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('delete message.__x_id')) { say('already patched.'); return true; }

  const idx = src.indexOf('...mediaOptions,');
  const start = idx === -1 ? -1 : src.lastIndexOf('const message = {', idx);
  if (idx === -1 || start === -1) {
    say('could not find the spot to patch - this version may already include the fix.');
    return false;
  }
  const rest = src.slice(idx);
  const m = /\n([ \t]*)\};/.exec(rest);
  if (!m) { say('could not find end of message object.'); return false; }

  const insertAt = idx + m.index + m[0].length;
  const indent = m[1];
  const patched =
    src.slice(0, insertAt) +
    '\n\n' + indent + '// patched: MediaData private id collides with Msg id\n' +
    indent + 'delete message.__x_id;' +
    src.slice(insertAt);

  try { fs.copyFileSync(file, file + '.bak'); } catch {}
  fs.writeFileSync(file, patched);
  say('patched ' + file);
  return true;
}

module.exports = { apply };
if (require.main === module) apply(false);
