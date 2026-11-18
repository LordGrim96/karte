// Tankbuch – Cloudflare Worker
//
// 1) Zwischendienst für die italienischen Spritpreise:
//    Der Server des italienischen Ministeriums (MIMIT) antwortet nicht auf Anfragen aus
//    US-Rechenzentren wie GitHub. Der Worker holt die zwei offenen CSV-Dateien und gibt sie
//    unverändert weiter. Es werden keine Daten gespeichert.
//
// 2) Preis-Alarm per Telegram (optional):
//    Einmal am Tag (Cron-Trigger) schaut der Worker in die aufbereiteten Preise und schickt
//    dir eine Telegram-Nachricht, wenn in deiner Nähe eine Tankstelle unter deinem Wunschpreis liegt.
//    Einstellungen als Variablen im Cloudflare-Dashboard (siehe cloudflare/ANLEITUNG.md):
//      TELEGRAM_TOKEN   (Geheimnis/Secret)  Token deines Telegram-Bots von @BotFather
//      TELEGRAM_CHAT_ID                     deine Chat-ID
//      ALARM_LAT, ALARM_LNG                 dein Ort, z. B. 46.498 und 11.354
//      ALARM_RADIUS                         Umkreis in km (Standard 10)
//      ALARM_FUEL                           benzina oder gasolio (Standard benzina)
//      ALARM_MAX_PRICE                      Wunschpreis, z. B. 1.80 – leer = jeden Tag die günstigsten melden
//    Zusätzlich beantwortet der Bot Befehle (/preise, /diesel, /benzin oder einen geteilten Standort).
//    Einmalig einschalten: /telegram-setup?chat=DEINE_CHAT_ID im Browser öffnen.
//
// 3) Profile & Cloud-Sync (optional):
//    Speichert das Tankbuch eines Profils – vorher auf dem Handy mit dem Passwort verschlüsselt.
//    Der Worker sieht weder Passwort noch Profilname noch Inhalt, nur einen unlesbaren Datenblock.
//    Braucht einen KV-Speicher mit dem Namen TANKBUCH_KV (siehe cloudflare/ANLEITUNG.md, Teil 3).
//
// Einrichten: siehe cloudflare/ANLEITUNG.md

const FILES = ['anagrafica_impianti_attivi.csv', 'prezzo_alle_8.csv'];   // nur diese zwei Dateien
const HOSTS = ['www.mimit.gov.it', 'mimit.gov.it', 'www.mise.gov.it'];
const ALLOWED_ORIGINS = ['https://lordgrim96.github.io'];                // nur das Tankbuch darf im Browser lesen
const IT_DATA = 'https://raw.githubusercontent.com/LordGrim96/karte/carburanti-data/it/';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, X-Auth',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const file = url.pathname.replace(/^\/+/, '');

    // Profile & Cloud-Sync: /sync/<id>
    const sm = file.match(/^sync\/([a-f0-9]{40})$/);
    if (sm) return sync(request, env, sm[1], cors);

    // Telegram schickt Nachrichten an den Bot hierher (nur mit geheimem Kennwort von Telegram)
    if (file === 'telegram' && request.method === 'POST') return botUpdate(request, env);
    if (request.method !== 'GET') return new Response('Nur GET erlaubt', { status: 405, headers: cors });

    // Test des Preis-Alarms: /alarm-test?chat=DEINE_CHAT_ID (nur mit der richtigen Chat-ID)
    // Bot-Befehle einschalten: /telegram-setup?chat=DEINE_CHAT_ID
    if (file === 'telegram-setup') {
      if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID || url.searchParams.get('chat') !== String(env.TELEGRAM_CHAT_ID)) {
        return text('Bitte so aufrufen: /telegram-setup?chat=DEINE_CHAT_ID (TELEGRAM_TOKEN und TELEGRAM_CHAT_ID müssen eingetragen sein).', 403);
      }
      try { return text(await botSetup(env, url.origin)); }
      catch (e) { return text('Fehler: ' + e.message, 500); }
    }

    if (file === 'alarm-test') {
      if (!env.TELEGRAM_CHAT_ID || url.searchParams.get('chat') !== String(env.TELEGRAM_CHAT_ID)) {
        return text('Bitte so aufrufen: /alarm-test?chat=DEINE_CHAT_ID (die Chat-ID muss mit TELEGRAM_CHAT_ID übereinstimmen).', 403);
      }
      try { return text(await runAlarm(env, true)); }
      catch (e) { return text('Fehler: ' + e.message, 500); }
    }

    if (!FILES.includes(file)) {
      return new Response('Tankbuch-Zwischendienst läuft ✓\nVerfügbar: /' + FILES.join(', /') + '\n', {
        status: file ? 404 : 200, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    let lastError = 'unbekannt';
    for (const host of HOSTS) {
      try {
        const r = await fetch(`https://${host}/images/exportCSV/${file}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (tankbuch-proxy)' },
          signal: AbortSignal.timeout(25000),
        });
        if (r.ok) {
          return new Response(r.body, {
            headers: { ...cors, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=1800', 'X-Quelle': host },
          });
        }
        lastError = `${host}: HTTP ${r.status}`;
      } catch (e) {
        lastError = `${host}: ${e.message}`;
      }
    }
    return new Response('MIMIT nicht erreichbar (' + lastError + ')', { status: 502, headers: cors });
  },

  // Cron-Trigger: täglicher Preis-Alarm
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlarm(env, false).catch(e => console.log('Preis-Alarm fehlgeschlagen: ' + e.message)));
  },
};

const text = (t, status = 200) => new Response(t, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

function distKm(a, b) {
  const R = 6371, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmt = p => p.toFixed(3).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Tankstellen rund um einen Ort aus den täglich aufbereiteten Preisen (GitHub)
async function stationsNear(pos, rad, fuel) {
  const meta = await (await fetch(IT_DATA + 'meta.json', { cf: { cacheTtl: 0 } })).json();
  const dLat = rad / 111, dLng = rad / (111 * Math.cos(pos.lat * Math.PI / 180)), keys = [];
  for (let la = Math.floor(pos.lat - dLat); la <= Math.floor(pos.lat + dLat); la++)
    for (let lo = Math.floor(pos.lng - dLng); lo <= Math.floor(pos.lng + dLng); lo++) keys.push(`${la}_${lo}`);
  const tiles = await Promise.all(keys.map(k => fetch(IT_DATA + k + '.json').then(r => r.ok ? r.json() : [])));
  const list = tiles.flat().map(x => {
    const p = x.p && x.p[fuel]; if (!p) return null;
    const price = p[0] || p[1], dist = distKm(pos, x);
    return dist <= rad && price ? { name: x.br || x.n, addr: `${x.a}, ${x.c}`, price, dist, lat: x.lat, lng: x.lng } : null;
  }).filter(Boolean).sort((a, b) => a.price - b.price);
  const stand = meta.updated ? meta.updated.slice(0, 10).split('-').reverse().join('.') : 'heute';
  return { list, stand };
}
const stationLines = list => list.slice(0, 5).map((x, i) =>
  `${i ? '•' : '🏆'} <b>${fmt(x.price)} €</b> – ${esc(x.name)}\n   ${esc(x.addr)} · ${x.dist.toFixed(1).replace('.', ',')} km · ` +
  `<a href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}">Route</a>`).join('\n');
function settings(env) {
  const pos = { lat: parseFloat(env.ALARM_LAT), lng: parseFloat(env.ALARM_LNG) };
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng) || Math.abs(pos.lat) > 90 || Math.abs(pos.lng) > 180)
    throw new Error('ALARM_LAT / ALARM_LNG fehlen oder sind ungültig (mit Punkt schreiben, z. B. 46.651)');
  return { pos, rad: Math.min(100, parseFloat(env.ALARM_RADIUS) || 10), fuel: /^(gasolio|diesel|d)$/i.test(env.ALARM_FUEL || '') ? 'd' : 'b',
    max: parseFloat(String(env.ALARM_MAX_PRICE || '').replace(',', '.')) };
}

async function runAlarm(env, isTest) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_TOKEN oder TELEGRAM_CHAT_ID fehlt');
  const { pos, rad, fuel, max } = settings(env);
  const { list, stand } = await stationsNear(pos, rad, fuel);
  const sorte = fuel === 'd' ? 'Diesel' : 'Benzin';
  const hits = Number.isFinite(max) ? list.filter(x => x.price <= max) : list;
  if (!hits.length) {
    const msg = `Kein ${sorte} unter ${fmt(max)} € im Umkreis von ${rad} km (günstigster: ${list[0] ? fmt(list[0].price) + ' €' : '–'}).`;
    if (isTest) await telegram(env, '🧪 Test – ' + msg);
    return isTest ? 'Test gesendet: ' + msg : msg;
  }
  const head = Number.isFinite(max)
    ? `⛽ <b>Preis-Alarm:</b> ${sorte} unter ${fmt(max)} € in deiner Nähe!`
    : `⛽ <b>Günstigstes ${sorte}</b> in deiner Nähe heute:`;
  await telegram(env, `${isTest ? '🧪 Test\n' : ''}${head}\n\n${stationLines(hits)}\n\n<i>Stand ${stand} · Daten: MIMIT</i>`);
  return 'Nachricht gesendet ✓';
}

/* ---------- Telegram-Bot: Befehle beantworten ---------- */
const KEYBOARD = { keyboard: [[{ text: '⛽ Preise' }, { text: '📍 Standort senden', request_location: true }], [{ text: 'Diesel' }, { text: 'Benzin' }]],
  resize_keyboard: true, is_persistent: true };
async function botSecret(env) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tankbuch-bot|' + env.TELEGRAM_TOKEN));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('Telegram: ' + (j.description || r.status));
  return j;
}
async function botSetup(env, origin) {
  await tg(env, 'setWebhook', { url: origin + '/telegram', secret_token: await botSecret(env), allowed_updates: ['message'], drop_pending_updates: true });
  await tg(env, 'setMyCommands', { commands: [
    { command: 'preise', description: 'Günstigste Tankstellen bei dir' },
    { command: 'diesel', description: 'Diesel-Preise' },
    { command: 'benzin', description: 'Benzin-Preise' },
    { command: 'hilfe', description: 'Was kann der Bot?' } ] });
  await tg(env, 'sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text: '✅ Bot ist bereit! Tippe unten auf „⛽ Preise“ oder teile deinen Standort.', reply_markup: KEYBOARD });
  return 'Bot-Befehle eingeschaltet ✓ – schau in Telegram.';
}
const HELP = '⛽ <b>Tankbuch-Bot</b>\n\n' +
  '• <b>⛽ Preise</b> oder /preise – die 5 günstigsten Tankstellen bei dir zuhause\n' +
  '• <b>Diesel</b> / <b>Benzin</b> – dieselbe Liste für die gewählte Sorte\n' +
  '• <b>📍 Standort senden</b> – Preise genau da, wo du gerade bist\n\n' +
  '<i>Preise vom italienischen Ministerium, Stand jeden Morgen.</i>';
async function botUpdate(request, env) {
  const ok = new Response('ok');
  if (!env.TELEGRAM_TOKEN || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await botSecret(env)) return new Response('nein', { status: 403 });
  let u; try { u = await request.json(); } catch { return ok; }
  const m = u && u.message; if (!m || !m.chat) return ok;
  const reply = (t, extra = {}) => tg(env, 'sendMessage', { chat_id: m.chat.id, text: t, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: KEYBOARD, ...extra }).catch(() => {});
  if (String(m.chat.id) !== String(env.TELEGRAM_CHAT_ID)) { await reply('🔒 Dieser Bot ist privat.', { reply_markup: { remove_keyboard: true } }); return ok; }
  try {
    const cfg = settings(env);
    let pos = cfg.pos, fuel = cfg.fuel, where = 'bei dir zuhause';
    if (m.location) { pos = { lat: m.location.latitude, lng: m.location.longitude }; where = 'an deinem Standort'; }
    else {
      const t = String(m.text || '').toLowerCase();
      if (/diesel|gasolio/.test(t)) fuel = 'd';
      else if (/benzin|benzina|super/.test(t)) fuel = 'b';
      else if (!/preis/.test(t)) { await reply(HELP); return ok; }
    }
    const sorte = fuel === 'd' ? 'Diesel' : 'Benzin';
    const { list, stand } = await stationsNear(pos, cfg.rad, fuel);
    if (!list.length) await reply(`Keine Tankstelle mit ${sorte}-Preis im Umkreis von ${cfg.rad} km gefunden ${where}. (Preise gibt es nur für Italien.)`);
    else await reply(`⛽ <b>${sorte} ${where}</b> – die günstigsten im Umkreis von ${cfg.rad} km:\n\n${stationLines(list)}\n\n<i>Stand ${stand} · Daten: MIMIT</i>`);
  } catch (e) { await reply('⚠️ ' + esc(e.message)); }
  return ok;
}

async function telegram(env, msg) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error('Telegram: ' + (await r.text()).slice(0, 200));
}

/* ---------- Profile & Cloud-Sync ---------- */
const MAX_BYTES = 5 * 1024 * 1024;
const json = (o, status, cors) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
async function sha256hex(t) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Vergleich in konstanter Zeit
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function sync(request, env, id, cors) {
  if (!env.TANKBUCH_KV) return json({ error: 'Cloud-Speicher ist im Worker nicht eingerichtet (KV TANKBUCH_KV fehlt)' }, 503, cors);
  const auth = request.headers.get('X-Auth') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(auth)) return json({ error: 'Anmeldung fehlt' }, 401, cors);
  const authHash = await sha256hex(auth);
  const key = 'p:' + id;
  const rec = await env.TANKBUCH_KV.get(key, 'json');
  if (rec && !same(rec.auth, authHash)) return json({ error: 'Profilname schon vergeben oder Passwort falsch' }, 401, cors);

  if (request.method === 'GET') {
    if (!rec) return json({ error: 'Profil nicht gefunden' }, 404, cors);
    return json({ v: rec.v, data: rec.data, at: rec.at }, 200, cors);
  }
  if (request.method === 'PUT') {
    const body = await request.text();
    if (body.length > MAX_BYTES) return json({ error: 'Daten zu groß' }, 413, cors);
    let b; try { b = JSON.parse(body); } catch { return json({ error: 'Ungültige Daten' }, 400, cors); }
    if (typeof b.data !== 'string' || !Number.isInteger(b.base)) return json({ error: 'Ungültige Daten' }, 400, cors);
    const cur = rec ? rec.v : 0;
    if (b.base !== cur) return json({ error: 'Veraltet', v: cur }, 409, cors);
    const next = { v: cur + 1, data: b.data, auth: authHash, at: new Date().toISOString() };
    await env.TANKBUCH_KV.put(key, JSON.stringify(next));
    return json({ v: next.v, at: next.at }, 200, cors);
  }
  if (request.method === 'DELETE') {
    if (rec) await env.TANKBUCH_KV.delete(key);
    return json({ ok: true }, 200, cors);
  }
  return json({ error: 'Methode nicht erlaubt' }, 405, cors);
}
