// Tankbuch – Zwischendienst für die italienischen Spritpreise (Cloudflare Worker)
//
// Der Server des italienischen Ministeriums (MIMIT) antwortet nicht auf Anfragen aus
// US-Rechenzentren wie GitHub. Dieser Worker läuft bei Cloudflare in der Nähe des
// Aufrufers (in Italien z. B. Mailand), holt die zwei offenen CSV-Dateien und gibt sie
// unverändert an das Tankbuch weiter. Es werden keine Daten gespeichert.
//
// Einrichten: siehe cloudflare/ANLEITUNG.md

const FILES = ['anagrafica_impianti_attivi.csv', 'prezzo_alle_8.csv'];   // nur diese zwei Dateien
const HOSTS = ['www.mimit.gov.it', 'mimit.gov.it', 'www.mise.gov.it'];
const ALLOWED_ORIGINS = ['https://lordgrim96.github.io'];                // nur das Tankbuch darf im Browser lesen

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Nur GET erlaubt', { status: 405, headers: cors });

    const file = new URL(request.url).pathname.replace(/^\/+/, '');
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
};
