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
      'Access-Control-Allow-Methods': 'GET',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Nur GET erlaubt', { status: 405, headers: cors });

    const url = new URL(request.url);
    const file = url.pathname.replace(/^\/+/, '');

    // Test des Preis-Alarms: /alarm-test?chat=DEINE_CHAT_ID (nur mit der richtigen Chat-ID)
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

async function runAlarm(env, isTest) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_TOKEN oder TELEGRAM_CHAT_ID fehlt');
  const pos = { lat: parseFloat(env.ALARM_LAT), lng: parseFloat(env.ALARM_LNG) };
  if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) throw new Error('ALARM_LAT / ALARM_LNG fehlen oder sind ungültig');
  const rad = Math.min(100, parseFloat(env.ALARM_RADIUS) || 10);
  const fuel = /^(gasolio|diesel|d)$/i.test(env.ALARM_FUEL || '') ? 'd' : 'b';
  const max = parseFloat(String(env.ALARM_MAX_PRICE || '').replace(',', '.'));

  // aufbereitete Tagespreise von GitHub (nur die Kacheln rund um den Ort)
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

  const sorte = fuel === 'd' ? 'Diesel' : 'Benzin';
  const hits = Number.isFinite(max) ? list.filter(x => x.price <= max) : list;
  if (!hits.length) {
    const msg = `Kein ${sorte} unter ${fmt(max)} € im Umkreis von ${rad} km (günstigster: ${list[0] ? fmt(list[0].price) + ' €' : '–'}).`;
    if (isTest) await telegram(env, '🧪 Test – ' + msg);
    return isTest ? 'Test gesendet: ' + msg : msg;
  }
  const lines = hits.slice(0, 5).map((x, i) =>
    `${i ? '•' : '🏆'} <b>${fmt(x.price)} €</b> – ${esc(x.name)}\n   ${esc(x.addr)} · ${x.dist.toFixed(1).replace('.', ',')} km · ` +
    `<a href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}">Route</a>`);
  const head = Number.isFinite(max)
    ? `⛽ <b>Preis-Alarm:</b> ${sorte} unter ${fmt(max)} € in deiner Nähe!`
    : `⛽ <b>Günstigstes ${sorte}</b> in deiner Nähe heute:`;
  const msg = `${isTest ? '🧪 Test\n' : ''}${head}\n\n${lines.join('\n')}\n\n<i>Stand ${meta.updated ? meta.updated.slice(0, 10).split('-').reverse().join('.') : 'heute'} · Daten: MIMIT</i>`;
  await telegram(env, msg);
  return 'Nachricht gesendet ✓';
}

async function telegram(env, msg) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error('Telegram: ' + (await r.text()).slice(0, 200));
}
