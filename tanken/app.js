// Tankbuch – Programmcode.
// Liegt bewusst in einer eigenen Datei: so kann die Seite per Sicherheitsregel (CSP) jeden
// eingeschleusten Inline-Code verweigern.
'use strict';
// nicht in fremden Seiten einbetten lassen (Schutz vor „Clickjacking“)
if (window.top !== window.self) { try { window.top.location = window.self.location.href; } catch { document.documentElement.hidden = true; } }

/* ---------- Grundlagen ---------- */
const KEY = 'tankbuch-v1', CARS = 'tankbuch-cars', PREFS = 'tankbuch-prefs';
const MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const MONTHS_LONG = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const CATS = [['werkstatt','Werkstatt','🔧'], ['versicherung','Versicherung','🛡️'], ['steuer','Kfz-Steuer (Bollo)','🏛️'], ['revision','Revision / Collaudo','🔍'],
  ['reifen','Reifen & Pflege','🛞'], ['waesche','Autowäsche','🧽'], ['parken','Parken & Maut','🅿️'], ['sonst','Sonstiges','📎']];
const catOf = id => CATS.find(c => c[0] === id) || CATS[CATS.length - 1];
const $ = id => document.getElementById(id);
const eur = n => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const num = (n, d = 0) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const parseNum = s => { s = String(s || '').trim().replace(/\s/g, ''); if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return isFinite(n) ? n : NaN; };
const iso = d => { d = new Date(d); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const today = () => iso(new Date());
const dmy = s => new Date(s + 'T00:00').toLocaleDateString('de-DE');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function read(k, def) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } }
function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

// Sicherheit: alle gespeicherten oder eingelesenen Daten auf erlaubte Werte zurechtstutzen,
// damit z. B. eine manipulierte Sicherungsdatei keinen Code in die Seite schleusen kann.
const safeId = v => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 40);
const nOrNull = v => v == null || v === '' ? null : (Number.isFinite(+v) ? +v : null);
const isoOrNull = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) ? v : null;
const txt = (v, n) => String(v ?? '').slice(0, n);
function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const x = { id: safeId(e.id) || uid(), date: isoOrNull(e.date), cost: nOrNull(e.cost), type: e.type === 'cost' ? 'cost' : 'fuel',
    car: safeId(e.car), note: txt(e.note, 200), created: nOrNull(e.created) || 0, updated: nOrNull(e.updated) || 0 };
  if (!x.date || !(x.cost > 0)) return null;
  if (x.type === 'cost') x.cat = CATS.some(c => c[0] === e.cat) ? e.cat : 'sonst';
  else Object.assign(x, { km: nOrNull(e.km), odo: nOrNull(e.odo), liter: nOrNull(e.liter) });
  return x;
}
function cleanCar(c) {
  if (!c || !safeId(c.id)) return null;
  const x = { id: safeId(c.id), name: txt(c.name || 'Auto', 60), updated: nOrNull(c.updated) || 0 };
  if (c.odo && nOrNull(c.odo.value) != null) x.odo = { value: nOrNull(c.odo.value), date: isoOrNull(c.odo.date) || today(), at: nOrNull(c.odo.at) || 0 };
  return x;
}
function cleanTerm(t) {
  if (!t || !safeId(t.id) || !t.title) return null;
  return { id: safeId(t.id), car: safeId(t.car), title: txt(t.title, 60), due: isoOrNull(t.due), dueKm: nOrNull(t.dueKm),
    everyMonths: nOrNull(t.everyMonths), everyKm: nOrNull(t.everyKm), amount: nOrNull(t.amount),
    reg: typeof t.reg === 'string' && /^\d{4}-\d\d$/.test(t.reg) ? t.reg : null, updated: nOrNull(t.updated) || 0 };
}
const cleanList = (a, f) => Array.isArray(a) ? a.map(f).filter(Boolean) : [];

let entries = cleanList(read(KEY, []), cleanEntry);
let cars = cleanList(read(CARS, null), cleanCar);
if (!cars.length) cars = [{ id: 'default', name: 'Mein Auto' }];
let prefs = Object.assign({ pKey: '', pType: 'e10', pRad: 5, pLoc: null, accent: 'gruen', theme: 'auto', mode: 'km', car: 'default', remind: true, lastBackup: null, snooze: null }, read(PREFS, {}));
// alte Einträge (vor Fahrzeugen/Kosten) ergänzen
entries.forEach(e => { if (!e.car) e.car = cars[0].id; });
if (!cars.some(c => c.id === prefs.car)) prefs.car = cars[0].id;

let editId = null, selectedYear = null, selMonth = null, kind = 'fuel', mode = prefs.mode, cat = 'werkstatt', listFilter = 'all';

function save() {
  if (window.syncReady) stamp();
  const ok = write(KEY, entries) && write(CARS, cars);
  if (window.syncReady) scheduleSync();
  if (!ok) toast('Speichern nicht möglich – bitte Sicherung herunterladen!');
  else if (!save.asked) { save.asked = true; protectStorage(true); }
}
const savePrefs = () => write(PREFS, prefs);
function toast(msg, ms = 2400) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
const byDate = (a, b) => a.date.localeCompare(b.date) || (a.created - b.created);
const fuelOf = car => entries.filter(e => e.type === 'fuel' && e.car === car).sort(byDate);
const curCar = () => cars.find(c => c.id === prefs.car) || cars[0];

// Rückfrage im eigenen Fenster: ask('Text') → true/false, ask('Text', {input: 'Vorgabe'}) → Text oder null
function ask(msg, { input = null, ok = 'OK', danger = false } = {}) {
  return new Promise(res => {
    $('dlgMsg').textContent = msg;
    $('dlgInput').hidden = input == null; $('dlgInput').value = input ?? '';
    $('dlgYes').textContent = ok; $('dlgYes').classList.toggle('danger', danger);
    $('dlg').hidden = false;
    if (input != null) setTimeout(() => $('dlgInput').focus(), 50);
    const done = v => { $('dlg').hidden = true; $('dlgYes').onclick = $('dlgNo').onclick = $('dlgInput').onkeydown = null; res(v); };
    $('dlgYes').onclick = () => done(input == null ? true : $('dlgInput').value.trim() || null);
    $('dlgNo').onclick = () => done(input == null ? false : null);
    $('dlgInput').onkeydown = e => { if (e.key === 'Enter') $('dlgYes').click(); };
  });
}

/* ---------- Berechnungen ---------- */
// Gefahrene km: direkt eingegeben oder Differenz zum vorherigen Tachostand desselben Fahrzeugs
function kmOf(e, list) {
  if (e.km != null) return e.km;
  if (e.odo == null) return null;
  for (let j = list.indexOf(e) - 1; j >= 0; j--) if (list[j].odo != null) return e.odo - list[j].odo;
  return null;
}
function lastOdo(date, car) {
  const l = fuelOf(car).filter(e => e.odo != null && e.date <= date && e.id !== editId);
  return l.length ? l[l.length - 1].odo : null;
}

function stats(year, car = prefs.car) {
  const fuel = fuelOf(car);
  const s = { cost: 0, km: 0, liter: 0, n: 0, kmCost: 0, litCost: 0, litKm: 0, litForKm: 0, other: 0, otherN: 0,
    cats: {}, prices: [], first: null,
    months: Array.from({ length: 12 }, () => ({ cost: 0, km: 0, n: 0, kmCost: 0 })) };
  for (const e of fuel) {
    if (+e.date.slice(0, 4) !== year) continue;
    const m = s.months[+e.date.slice(5, 7) - 1], km = kmOf(e, fuel);
    s.first ||= e.date;
    s.cost += e.cost; m.cost += e.cost; s.n++; m.n++;
    // für €/100 km nur Tankvorgänge mit bekannten km, sonst wäre der Wert verfälscht
    if (km != null && km > 0) { s.km += km; m.km += km; s.kmCost += e.cost; m.kmCost += e.cost; }
    if (e.liter) {
      s.liter += e.liter; s.litCost += e.cost; s.prices.push({ date: e.date, p: e.cost / e.liter });
      if (km > 0) { s.litKm += km; s.litForKm += e.liter; }
    }
  }
  for (const e of entries) {
    if (e.type !== 'cost' || e.car !== car || +e.date.slice(0, 4) !== year) continue;
    s.other += e.cost; s.otherN++; s.cats[e.cat] = (s.cats[e.cat] || 0) + e.cost;
  }
  s.per100 = s.km ? s.kmCost / s.km * 100 : null;
  s.perLiter = s.liter ? s.litCost / s.liter : null;
  s.cons = s.litKm ? s.litForKm / s.litKm * 100 : null;
  s.total = s.cost + s.other;
  return s;
}
// Hochrechnung der Tankkosten aufs ganze Jahr (nur fürs laufende Jahr)
function projection(year, s) {
  const now = new Date();
  if (year !== now.getFullYear() || s.n < 2) return null;
  const jan1 = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
  const hadBefore = stats(year - 1).n > 0;
  const start = hadBefore ? jan1 : new Date(s.first + 'T00:00');
  const days = (now - start) / 864e5 + 1;
  if (days < 21) return null;
  return s.cost / days * ((end - start) / 864e5);
}
function years() {
  const ys = new Set(entries.filter(e => e.car === prefs.car).map(e => +e.date.slice(0, 4)));
  ys.add(new Date().getFullYear());
  return [...ys].sort((a, b) => b - a);
}
function delta(cur, prev, lowerIsBetter = true) {
  if (cur == null || !prev) return '';
  const p = (cur - prev) / prev * 100;
  if (Math.abs(p) < 0.5) return `<span class="d same">≈ wie Vorjahr</span>`;
  const cls = (p > 0) === lowerIsBetter ? 'up' : 'down';
  return `<span class="d ${cls}">${p > 0 ? '▲' : '▼'} ${num(Math.abs(p))} % zum Vorjahr</span>`;
}

/* ---------- Anzeige ---------- */
function render() {
  const ys = years();
  if (!ys.includes(selectedYear)) selectedYear = ys[0];
  $('year').innerHTML = ys.map(y => `<option ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('');
  $('carChip').hidden = cars.length < 2;
  $('brandTx').hidden = cars.length > 1;  // Platz für die Fahrzeugauswahl
  $('car').innerHTML = cars.map(c => `<option value="${esc(c.id)}" ${c.id === prefs.car ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const s = stats(selectedYear), p = stats(selectedYear - 1), hasPrev = p.n > 0;

  // Kopfbereich
  $('heroLbl').textContent = `Tankkosten ${selectedYear}` + (cars.length > 1 ? ` · ${curCar().name}` : '');
  $('heroBig').textContent = eur(s.cost);
  const pills = [];
  if (hasPrev && s.n) { const d = (s.cost - p.cost) / p.cost * 100; pills.push(`${d >= 0 ? '▲' : '▼'} ${num(Math.abs(d))} % · Vorjahr ${eur(p.cost)}`); }
  else pills.push(s.n ? s.n + (s.n === 1 ? ' Tankvorgang' : ' Tankvorgänge') : 'Noch keine Einträge');
  const proj = projection(selectedYear, s);
  if (proj) pills.push(`📈 Hochrechnung ${selectedYear}: ≈ ${eur(Math.round(proj))}`);
  $('heroPill').innerHTML = pills.map(t => `<span class="pill">${t}</span>`).join('');

  $('trio').innerHTML = [[num(s.km), 'km gefahren'], [s.per100 != null ? eur(s.per100) : '–', 'pro 100 km'], [s.n, 'mal getankt']]
    .map(([v, l]) => `<div><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  // Monatsdiagramm: dieses Jahr vorne, Vorjahr blass dahinter
  const max = Math.max(1, ...s.months.map(m => m.cost), ...p.months.map(m => m.cost));
  const now = new Date(), curM = now.getFullYear() === selectedYear ? now.getMonth() : -1;
  $('chart').innerHTML = s.months.map((m, i) =>
    `<div class="col${i === curM ? ' now' : ''}${i === selMonth ? ' sel' : ''}" data-m="${i}">
       <div class="prev" style="height:${p.months[i].cost / max * 100}%"></div>
       <div class="cur" style="height:${m.cost / max * 100}%"></div></div>`).join('');
  $('monthLbl').innerHTML = MONTHS.map(m => `<span>${m[0]}</span>`).join('');
  $('lgCur').textContent = selectedYear; $('lgPrev').textContent = selectedYear - 1;
  showTip(s, p);

  // Kennzahlen
  const k = (ic, v, l, d = '', cls = '') => `<div class="kpi ${cls}"><div class="ic">${icon(ic)}</div><div class="v">${v}</div><div class="l">${l}</div>${d}</div>`;
  $('kpis').innerHTML = !s.n ? '' :
    k('euro', s.per100 != null ? num(s.per100, 1) + ' ct' : '–', 'Spritkosten pro km', hasPrev ? delta(s.per100, p.per100) : '') +
    k('road', num(s.km) + ' km', 'gefahrene Strecke', hasPrev ? delta(s.km, p.km, false) : '') +
    k('drop', s.perLiter ? eur(s.perLiter) : '–', 'Ø Preis pro Liter', hasPrev ? delta(s.perLiter, p.perLiter) : '', 'amber') +
    k('gauge', s.cons ? num(s.cons, 1) + ' l' : '–', 'Verbrauch / 100 km', hasPrev ? delta(s.cons, p.cons) : '', 'amber') +
    k('cal', eur(s.cost / Math.max(1, curM >= 0 ? curM + 1 : 12)), 'Ø Tankkosten / Monat') +
    k('trend', proj ? '≈ ' + eur(Math.round(proj)) : (curM < 0 ? eur(s.cost) : '–'), curM < 0 ? 'Tankkosten im Jahr' : 'Hochrechnung bis 31.12.',
      proj && hasPrev ? delta(proj, p.cost) : (proj ? '' : curM >= 0 ? '<span class="d same">ab 3 Wochen Daten</span>' : ''), 'blue');

  renderPrice(s, p);
  renderOther(s, p);
  renderList(); renderCompare(ys); renderCars(); renderBackup(); renderTerms(); renderPrices(); renderMore();
}

function showTip(s, p) {
  if (selMonth == null) { $('tip').innerHTML = s.n ? 'Tippe auf einen Monat für Details' : 'Tippe auf <b>+</b>, um deinen ersten Tankbon einzutragen'; return; }
  const m = s.months[selMonth], pm = p.months[selMonth];
  $('tip').innerHTML = `<b>${MONTHS_LONG[selMonth]}:</b> ${eur(m.cost)} · ${num(m.km)} km` +
    (m.km ? ` · ${eur(m.kmCost / m.km * 100)}/100 km` : '') + (pm.n ? `<br>Vorjahr: ${eur(pm.cost)}` : '');
}

function renderPrice(s, p) {
  const pts = s.prices;
  $('priceCard').hidden = pts.length < 2;
  if (pts.length < 2) return;
  const W = 320, H = 130, L = 34, R = 8, T = 10, B = 20;
  const all = pts.map(x => x.p), lo = Math.min(...all), hi = Math.max(...all);
  const pad = Math.max(0.03, (hi - lo) * 0.15), y0 = lo - pad, y1 = hi + pad;
  const dayOf = d => (new Date(d + 'T00:00') - new Date(selectedYear, 0, 1)) / 864e5;
  const X = d => L + dayOf(d) / 365 * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const line = pts.map(x => `${X(x.date).toFixed(1)},${Y(x.p).toFixed(1)}`).join(' ');
  const area = `${X(pts[0].date).toFixed(1)},${H - B} ${line} ${X(pts[pts.length - 1].date).toFixed(1)},${H - B}`;
  let grid = '';
  for (let i = 0; i <= 2; i++) { const v = y0 + (y1 - y0) * i / 2;
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${num(v, 2)}</text>`; }
  [0, 3, 6, 9].forEach(m => { grid += `<text class="ax" x="${X(iso(new Date(selectedYear, m, 1)))}" y="${H - 5}">${MONTHS[m]}</text>`; });
  const avg = s.perLiter;
  $('priceChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Literpreis im Jahresverlauf">${grid}
    <polygon class="area" points="${area}"/><line class="avg" x1="${L}" x2="${W - R}" y1="${Y(avg)}" y2="${Y(avg)}"/>
    <polyline class="ln" points="${line}"/>${pts.map(x => `<circle r="3.2" cx="${X(x.date)}" cy="${Y(x.p)}"><title>${dmy(x.date)}: ${eur(x.p)}/l</title></circle>`).join('')}</svg>`;
  const min = pts.reduce((a, b) => b.p < a.p ? b : a), mx = pts.reduce((a, b) => b.p > a.p ? b : a);
  $('priceFacts').innerHTML = `<div><b>${num(min.p, 3)} €</b><span>günstigster · ${dmy(min.date).slice(0, -5)}</span></div>
    <div><b>${num(avg, 3)} €</b><span>Durchschnitt${p.perLiter ? ' · VJ ' + num(p.perLiter, 2) : ''}</span></div>
    <div><b>${num(mx.p, 3)} €</b><span>teuerster · ${dmy(mx.date).slice(0, -5)}</span></div>`;
}

function renderOther(s, p) {
  const rows = [['fuel', 'Tanken', '⛽', s.cost], ...CATS.filter(c => s.cats[c[0]]).map(c => [c[0], c[1], c[2], s.cats[c[0]]])];
  const max = Math.max(1, ...rows.map(r => r[3]));
  $('otherSub').textContent = s.otherN ? `${s.otherN} weitere Kosten` : '';
  $('cats').innerHTML = rows.map(([id, name, em, v]) => `<div class="cat"><div class="em">${em}</div>
    <div><div class="nm">${name}</div><div class="tr"><i style="width:${v / max * 100}%;${id === 'fuel' ? 'background:var(--primary)' : ''}"></i></div></div>
    <div class="am">${eur(v)}</div></div>`).join('') +
    (s.otherN ? '' : `<p class="note" style="margin:4px 0 0">Werkstatt, Versicherung, Steuer & Co. über <b>+</b> → „Sonstige Kosten“ eintragen.</p>`);
  const perKm = s.km ? (s.kmCost + s.other) / s.km * 100 : null;
  $('carTotal').innerHTML = `<div><span>Auto gesamt ${selectedYear}</span><small>${perKm != null ? num(perKm, 1) + ' ct pro km · ' : ''}${eur(s.total / 12)} pro Monat</small></div>
    <div style="text-align:right"><b>${eur(s.total)}</b>${p.total ? `<small>Vorjahr ${eur(p.total)}</small>` : ''}</div>`;
}

function renderList() {
  const fuel = fuelOf(prefs.car);
  const list = entries.filter(e => e.car === prefs.car && +e.date.slice(0, 4) === selectedYear && (listFilter === 'all' || e.type === listFilter))
    .sort(byDate).reverse();
  $('listCount').textContent = `${selectedYear} · ${list.length}`;
  if (!list.length) { $('list').innerHTML = `<div class="empty"><div class="e">⛽</div>Noch keine Einträge in ${selectedYear}.<br>Tippe unten auf <b>+</b>.</div>`; return; }
  let html = '', lastM = null;
  for (const e of list) {
    const d = new Date(e.date + 'T00:00'), mo = d.getMonth();
    if (mo !== lastM) { html += `<div class="group">${MONTHS_LONG[mo]}</div>`; lastM = mo; }
    if (e.type === 'cost') {
      const c = catOf(e.cat);
      html += `<button class="entry other" data-id="${esc(e.id)}"><div class="day"><b>${d.getDate()}</b><small>${MONTHS[mo]}</small></div>
        <div class="mid"><div class="t">${c[2]} ${c[1]}</div><div class="s">${e.note ? esc(e.note) : '&nbsp;'}</div></div>
        <div class="amt">${eur(e.cost)}</div></button>`;
    } else {
      const km = kmOf(e, fuel);
      const sub = [km != null ? num(km) + ' km' : null, e.liter ? num(e.liter, 1) + ' l' : null].filter(Boolean).join(' · ');
      html += `<button class="entry" data-id="${esc(e.id)}"><div class="day"><b>${d.getDate()}</b><small>${MONTHS[mo]}</small></div>
        <div class="mid"><div class="t">${e.note ? esc(e.note) : 'Tanken'}</div><div class="s">${sub || '–'}</div></div>
        <div class="amt">${eur(e.cost)}${e.liter ? `<small>${eur(e.cost / e.liter)}/l</small>` : ''}</div></button>`;
    }
  }
  $('list').innerHTML = html;
}

/* ---------- Deine Tankstellen: wo am häufigsten, wo am günstigsten ---------- */
function renderStationStats() {
  const fuel = fuelOf(prefs.car).filter(e => e.liter > 0 || e.note);
  const groups = new Map();
  for (const e of fuel) {
    const name = (e.note || '').trim(); if (!name) continue;
    const k = name.toLowerCase();
    const g = groups.get(k) || { name, n: 0, cost: 0, liter: 0, last: '' };
    g.n++; if (e.liter > 0) { g.cost += e.cost; g.liter += e.liter; } if (e.date > g.last) g.last = e.date;
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((a, b) => b.n - a.n || (a.liter ? a.cost / a.liter : 9) - (b.liter ? b.cost / b.liter : 9));
  const withPrice = list.filter(g => g.liter > 0);
  const best = withPrice.length > 1 ? withPrice.reduce((a, b) => a.cost / a.liter <= b.cost / b.liter ? a : b) : null;
  $('statSub').textContent = list.length ? `${list.length} Tankstellen` : '';
  $('stationStats').innerHTML = !list.length
    ? `<p class="note" style="margin:0">Hier siehst du, wo du am häufigsten und am günstigsten tankst. Tipp: Beim Eintragen auf „Übernehmen“ tippen – dann wird die Tankstelle automatisch gespeichert.</p>`
    : list.slice(0, 8).map((g, i) => `<div class="srow${g === best ? ' best' : ''}"><div class="rk">${i + 1}</div>
        <div class="n">${esc(g.name)}${g === best ? ' 🏆' : ''}</div>
        <div class="v">${g.liter ? num(g.cost / g.liter, 3) + ' €' : '–'}<small>Ø pro Liter</small></div>
        <div class="s">${g.n}× getankt · zuletzt ${dmy(g.last)}</div></div>`).join('') +
      (best ? `<p class="note" style="margin:10px 0 0">🏆 Im Schnitt am günstigsten: <b>${esc(best.name)}</b>.</p>` : '');
}
function renderCompare(ys) {
  renderStationStats();
  const rows = ys.map(y => [y, stats(y)]).filter(([, st]) => st.n || st.otherN);
  if (!rows.length) { $('compare').innerHTML = `<div class="empty"><div class="e">📊</div>Sobald du tankst, siehst du hier die Jahre im Vergleich.</div>`; return; }
  const max = Math.max(...rows.map(([, st]) => st.total));
  $('compare').innerHTML = rows.map(([y, st]) => `
    <div class="yr${y === selectedYear ? ' sel' : ''}">
      <div class="h"><b>${y}</b><span>${eur(st.total)}</span></div>
      <div class="track"><div class="fill" style="width:${st.cost / max * 100}%"></div><div class="fill o" style="width:${st.other / max * 100}%"></div></div>
      <div class="meta"><span>⛽ <b>${eur(st.cost)}</b></span>${st.other ? `<span>🔧 <b>${eur(st.other)}</b></span>` : ''}
        <span><b>${num(st.km)}</b> km</span><span><b>${st.per100 != null ? eur(st.per100) : '–'}</b> /100 km</span>
        ${st.perLiter ? `<span><b>${eur(st.perLiter)}</b> /l</span>` : ''}${st.cons ? `<span><b>${num(st.cons, 1)} l</b> /100 km</span>` : ''}
        <span><b>${st.n}</b>× getankt</span></div>
    </div>`).join('');
}

function renderCars() {
  $('cars').innerHTML = cars.map(c => {
    const n = entries.filter(e => e.car === c.id).length;
    return `<div class="car"><div class="nm">${c.id === prefs.car ? '✅ ' : '🚗 '}${esc(c.name)}<small>${n} Einträge</small></div>
      ${c.id !== prefs.car ? `<button class="icon-btn" data-sel="${esc(c.id)}" title="Auswählen">✓</button>` : ''}
      <button class="icon-btn" data-ren="${esc(c.id)}" title="Umbenennen">${icon('note')}</button>
      ${cars.length > 1 ? `<button class="icon-btn r" data-del="${esc(c.id)}" title="Löschen">${icon('trash')}</button>` : ''}</div>`;
  }).join('');
  $('f-car').innerHTML = cars.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('carField').hidden = cars.length < 2;
}

/* ---------- Erinnerung an die Sicherung ---------- */
function renderBackup() {
  $('remind').checked = prefs.remind;
  $('lastBackup').textContent = prefs.lastBackup ? `Letzte Sicherung: ${dmy(prefs.lastBackup)}.` : 'Du hast noch keine Sicherung gespeichert.';
  const now = new Date(), days = prefs.lastBackup ? (now - new Date(prefs.lastBackup + 'T00:00')) / 864e5 : Infinity;
  const snoozed = prefs.snooze && new Date(prefs.snooze + 'T00:00') > now;
  const yearEnd = now.getMonth() === 11 && now.getDate() >= 15 && !(prefs.lastBackup || '').startsWith(now.getFullYear() + '-12');
  let msg = null;
  if (prefs.remind && entries.length >= 3 && !snoozed) {
    if (yearEnd) msg = '<b>Das Jahr ist bald zu Ende</b>Speichere jetzt eine Sicherung deines Tankbuchs.';
    else if (days > 30) msg = prefs.lastBackup ? `<b>Letzte Sicherung vor ${Math.floor(days)} Tagen</b>Zeit für eine neue Sicherung.` : '<b>Noch keine Sicherung</b>Speichere deine Daten, damit nichts verloren geht.';
  }
  $('backupBanner').hidden = !msg;
  if (msg) $('backupText').innerHTML = msg;
  try { renderMore(); } catch { /* beim Start noch nicht bereit */ }
}

/* ---------- Farben & Hell/Dunkel ---------- */
// h: Farbverlauf oben, hi: helle Akzentfarbe, l/d: Hauptfarbe + zarter Hintergrund für hell/dunkel, bg: Seitenhintergrund hell/dunkel
const ACCENTS = {
  gruen:   { name: 'Grün',    h: ['#17a571', '#0c5a3f', '#083828'], hi: '#2bd08f', l: ['#0f7a52', '#e2f3ea'], d: ['#34c486', '#18352a'], bg: ['#eef3f0', '#141b17'] },
  petrol:  { name: 'Petrol',  h: ['#14b8a6', '#0f766e', '#042f2e'], hi: '#2dd4bf', l: ['#0f766e', '#ddf3ef'], d: ['#3dd6c3', '#123532'], bg: ['#edf4f3', '#131c1b'] },
  blau:    { name: 'Blau',    h: ['#3b82f6', '#1d4ed8', '#172554'], hi: '#60a5fa', l: ['#1d5fd1', '#e3ecfd'], d: ['#6ea4ff', '#18284a'], bg: ['#eef2f8', '#121824'] },
  lila:    { name: 'Lila',    h: ['#efe2ff', '#d5b8ff', '#b28cf8'], hi: '#c9a6ff', l: ['#8b5cf6', '#f2eaff'], d: ['#c8adff', '#3a2d57'], bg: ['#faf6ff', '#221c2e'],
             ink: '#34105f', fab: ['#a78bfa', '#7c3aed'], cardD: ['#2c2540', '#3e3456'] },
  pink:    { name: 'Pink',    h: ['#ec4899', '#be185d', '#500724'], hi: '#f472b6', l: ['#be185d', '#fce7f2'], d: ['#f58bc0', '#43162d'], bg: ['#f8eff3', '#20141a'] },
  rot:     { name: 'Rot',     h: ['#f43f5e', '#be123c', '#4c0519'], hi: '#fb7185', l: ['#c81e4a', '#fde6eb'], d: ['#ff7a95', '#44161f'], bg: ['#f8eff1', '#201416'] },
  orange:  { name: 'Orange',  h: ['#fb923c', '#ea580c', '#7c2d12'], hi: '#fdba74', l: ['#c2410c', '#fdeee3'], d: ['#ff9d5c', '#42240f'], bg: ['#f8f2ed', '#1f1913'] },
  graphit: { name: 'Graphit', h: ['#64748b', '#334155', '#0f172a'], hi: '#94a3b8', l: ['#334155', '#e8ecf1'], d: ['#a5b4c8', '#222b38'], bg: ['#f0f2f5', '#16191f'] },
};
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const a = ACCENTS[prefs.accent] || ACCENTS.gruen, root = document.documentElement;
  if (prefs.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = prefs.theme;
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && darkMQ.matches);
  const [primary, soft] = dark ? a.d : a.l;
  const v = { '--h1': a.h[0], '--h2': a.h[1], '--h3': a.h[2], '--hi': a.hi, '--primary': primary, '--soft': soft,
    '--bg': a.ink ? (dark ? a.bg[1] : a.bg[0]) : (dark ? '#121215' : '#f2f2f7'), '--glow': (a.fab ? a.fab[1] : a.h[1]) + '73', '--on-dark': a.ink || a.h[2],
    // helle Farbschemas bekommen dunkle Schrift im Kopfbereich
    '--on-h': a.ink || '#fff', '--pill-bg': a.ink ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.16)',
    '--pill-line': a.ink ? 'rgba(52,16,95,.18)' : 'rgba(255,255,255,.25)',
    '--fab1': a.fab ? a.fab[0] : a.hi, '--fab2': a.fab ? a.fab[1] : a.h[1] };
  if (dark && a.cardD) { v['--card'] = a.cardD[0]; v['--line'] = a.cardD[1]; } else { root.style.removeProperty('--card'); root.style.removeProperty('--line'); }
  for (const k in v) root.style.setProperty(k, v[k]);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', a.h[1]);
  $('swatches').innerHTML = Object.entries(ACCENTS).map(([id, x]) =>
    `<button type="button" class="sw${id === prefs.accent ? ' on' : ''}" data-a="${id}" aria-label="${x.name}"><i style="background:linear-gradient(150deg,${x.h[x.ink ? 1 : 0]},${x.h[x.ink ? 2 : 1]});color:${x.ink || '#fff'}">${id === prefs.accent ? '✓' : ''}</i>${x.name}</button>`).join('');
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === prefs.theme));
  try { renderMore(); } catch { /* beim Start noch nicht bereit */ }
}
darkMQ.addEventListener?.('change', applyTheme);
$('swatches').onclick = e => { const b = e.target.closest('.sw'); if (!b) return; prefs.accent = b.dataset.a; savePrefs(); applyTheme(); };
$('themeSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.theme = b.dataset.t; savePrefs(); applyTheme(); };

/* ---------- Navigation ---------- */
function show(v) {
  closePage();
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('on', el.id === 'v-' + v));
  document.querySelectorAll('nav .tab').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  document.body.className = document.body.className.replace(/\btab-\S+/g, '').trim() + ' tab-' + v;
  window.scrollTo({ top: 0 });
  if (v === 'home' && pmap) setTimeout(() => pmap.invalidateSize(), 50);
}

/* ---------- „Mehr“: Einstellungs-Liste mit Unterseiten (wie in iOS) ---------- */
function openPage(name) {
  closePage();
  const pg = $('pg-' + name); if (!pg) return;
  pg.classList.add('open'); pg.querySelector('.pbody').scrollTop = 0;
  if (name === 'terms') renderTerms();
}
function closePage() { document.querySelectorAll('.page.open').forEach(p => p.classList.remove('open')); }
document.querySelectorAll('.row-item[data-page]').forEach(b => b.onclick = () => openPage(b.dataset.page));
document.querySelectorAll('[data-back]').forEach(b => b.onclick = closePage);
// rechts in der Liste den aktuellen Stand zeigen
function renderMore() {
  const set = (k, v) => { const el = $('rv-' + k); if (el) el.textContent = v; };
  set('cars', cars.length > 1 ? `${cars.length} · ${curCar().name}` : curCar().name);
  const mine = terms.filter(t => t.car === prefs.car), due = mine.filter(t => termState(t).level > 0).length;
  set('terms', due ? `${due} fällig` : mine.length ? `${mine.length}` : 'Keine');
  set('prices', prefs.pLoc ? `${TYPES[prefs.pType]} · ${prefs.pRad} km` : 'Aus');
  set('alarm', prefs.tg && prefs.tg.on ? 'Termine an' : '');
  set('sync', prefs.sync ? 'Angemeldet' : 'Aus');
  set('backup', prefs.lastBackup ? dmy(prefs.lastBackup) : 'Nie');
  set('look', (ACCENTS[prefs.accent] || ACCENTS.gruen).name);
}
document.querySelectorAll('nav .tab').forEach(b => b.onclick = () => show(b.dataset.v));
$('year').onchange = e => { selectedYear = +e.target.value; selMonth = null; render(); };
$('car').onchange = e => { prefs.car = e.target.value; savePrefs(); selMonth = null; render(); };
$('chart').addEventListener('click', e => {
  const c = e.target.closest('.col'); if (!c) return;
  selMonth = selMonth === +c.dataset.m ? null : +c.dataset.m; render();
});
$('filter').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  listFilter = b.dataset.f; document.querySelectorAll('#filter button').forEach(x => x.classList.toggle('on', x === b)); renderList(); };

/* ---------- Eingabe-Blatt ---------- */
function setKind(k) {
  kind = k;
  document.querySelectorAll('#kind button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  document.querySelectorAll('.fuel-only').forEach(el => el.hidden = k !== 'fuel');
  document.querySelectorAll('.cost-only').forEach(el => el.hidden = k !== 'cost');
  if ($('hereBox')) $('hereBox').hidden = k !== 'fuel' || !here;
  $('amountBox').classList.toggle('o', k === 'cost');
  $('amountCap').textContent = k === 'fuel' ? 'Betrag laut Bon' : 'Betrag';
  $('noteField').style.gridColumn = k === 'cost' ? '1 / -1' : '';
  $('saveBtn').style.background = k === 'cost' ? 'var(--blue)' : '';
}
function setMode(m) {
  mode = m;
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('f-dist').placeholder = m === 'km' ? 'seit dem letzten Tanken' : 'aktueller Kilometerstand';
  updateCalc();
}
function setCat(c) { cat = c; renderCatPick(); }
function renderCatPick() {
  $('catpick').innerHTML = CATS.map(c => `<button type="button" data-c="${c[0]}" class="${c[0] === cat ? 'on' : ''}">${c[2]} ${c[1]}</button>`).join('');
}
function updateCalc() {
  const cost = parseNum($('f-cost').value), v = parseNum($('f-dist').value), liter = parseNum($('f-liter').value);
  let km = mode === 'km' ? v : null; const parts = [];
  if (mode === 'odo') {
    const lo = lastOdo($('f-date').value || today(), $('f-car').value || prefs.car);
    if (lo == null) parts.push('Erster Tachostand – km werden ab dem nächsten Mal berechnet');
    else if (v > lo) { km = v - lo; parts.push(`${num(km)} km seit ${num(lo)} km`); }
    else parts.push(`Letzter Stand: ${num(lo)} km`);
  }
  if (cost > 0 && km > 0) parts.push(`${eur(cost / km * 100)} / 100 km`);
  if (cost > 0 && liter > 0) parts.push(`${eur(cost / liter)} / l`);
  $('calc').textContent = parts.join(' · ');
}
function openSheet(e) {
  editId = e ? e.id : null;
  const f = v => v == null ? '' : String(v).replace('.', ',');
  $('form').reset();
  renderCars();
  $('f-car').value = e ? e.car : prefs.car;
  $('f-date').value = e ? e.date : today();
  $('f-cost').value = e ? f(e.cost) : '';
  $('f-liter').value = e && e.type === 'fuel' ? f(e.liter) : '';
  $('f-note').value = e ? e.note || '' : '';
  setKind(e ? e.type : 'fuel');
  $('kind').hidden = !!e;
  if (e && e.type === 'cost') setCat(e.cat || 'sonst'); else renderCatPick();
  const m = e && e.type === 'fuel' ? (e.km != null ? 'km' : 'odo') : prefs.mode;
  $('f-dist').value = e && e.type === 'fuel' ? f(m === 'km' ? e.km : e.odo) : '';
  setMode(m);
  resetScan();
  $('f-liter').dataset.auto = '';
  if (!e) setTimeout(detectStation, 0); else { here = null; $('hereBox').hidden = true; }
  $('formTitle').textContent = e ? 'Eintrag bearbeiten' : 'Eintragen';
  $('saveBtn').textContent = e ? 'Änderung speichern' : 'Speichern';
  $('delBtn').hidden = !e;
  document.body.classList.add('sheet-open'); $('form').classList.add('open');
}
function closeSheet() { document.body.classList.remove('sheet-open'); document.querySelectorAll('.sheet').forEach(x => x.classList.remove('open')); document.activeElement?.blur(); }
$('fab').onclick = () => openSheet();
$('close').onclick = $('scrim').onclick = closeSheet;
$('kind').onclick = e => { const b = e.target.closest('button'); if (b) setKind(b.dataset.k); };
$('seg').onclick = e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); };
$('catpick').onclick = e => { const b = e.target.closest('button'); if (b) setCat(b.dataset.c); };
['f-cost', 'f-dist', 'f-liter', 'f-date', 'f-car'].forEach(id => $(id).addEventListener('input', updateCalc));

/* Tankstelle beim Eintragen erkennen (Standort + Spritpreise) */
let here = null, hereRun = 0;
async function nearestStation(pos) {
  if (inItaly(pos)) {
    const data = await italyTiles(pos, 1) || await italyViaProxy(pos);
    if (!data) return null;
    const fuel = prefs.pType === 'diesel' ? 'd' : 'b';
    const best = data.items.map(x => ({ x, d: distKm(pos, x) })).filter(o => o.d <= 0.3 && o.x.p && o.x.p[fuel]).sort((a, b) => a.d - b.d)[0];
    if (!best) return null;
    const p = best.x.p[fuel];
    return { name: txt(best.x.br || best.x.n, 60), street: txt(`${best.x.a}, ${best.x.c}`, 90), price: +(p[0] || p[1]), self: !!p[0], dist: best.d, it: true };
  }
  if (!prefs.pKey) return null;
  const u = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${pos.lat.toFixed(3)}&lng=${pos.lng.toFixed(3)}&rad=1&sort=dist&type=${prefs.pType}&apikey=${encodeURIComponent(prefs.pKey)}`;
  const j = await (await fetch(u)).json();
  const x = (j.stations || []).find(s => +s.dist <= 0.3 && +s.price > 0);
  return x ? { name: txt(x.brand || x.name, 60), street: txt([x.street, x.houseNumber, x.place].filter(Boolean).join(' '), 90), price: +x.price, dist: +x.dist } : null;
}
async function detectStation() {
  here = null; $('hereBox').hidden = true;
  if (!prefs.pLoc || editId) return;           // nur wenn Spritpreise eingerichtet sind, nur bei neuen Einträgen
  const run = ++hereRun;
  try {
    const pos = await getPosition();
    const st = await nearestStation(pos);
    if (run !== hereRun || !st || !Number.isFinite(st.price) || !document.body.classList.contains('sheet-open') || kind !== 'fuel') return;
    here = st;
    const sorte = prefs.pType === 'diesel' ? 'Diesel' : st.it ? 'Benzin' : prefs.pType === 'e5' ? 'Super E5' : 'Super E10';
    $('hereBox').className = 'here';
    $('hereBox').innerHTML = `<span class="em">📍</span><div class="tx">Du bist bei <b>${esc(st.name)}</b> – ${sorte} <b>${num(st.price, 3)} €/l</b>${st.self ? ' (Self)' : ''}
      <small>${esc(st.street)}</small></div><button type="button" id="hereUse">Übernehmen</button>`;
    $('hereBox').hidden = false;
    $('hereUse').onclick = () => {
      if (!$('f-note').value) $('f-note').value = st.name;
      here.used = true; fillLiterFromPrice(true);
      $('hereBox').classList.add('done'); $('hereUse').textContent = '✓';
      toast('Tankstelle übernommen – Liter werden aus dem Betrag berechnet');
    };
  } catch { /* kein Standort oder keine Verbindung – dann eben ohne Vorschlag */ }
}
// Liter aus Betrag und Literpreis der erkannten Tankstelle ausrechnen (solange du sie nicht selbst änderst)
function fillLiterFromPrice(force) {
  if (!here || !here.used) return;
  const cost = parseNum($('f-cost').value), li = $('f-liter');
  if (!(cost > 0) || (li.value && li.dataset.auto !== '1' && !force)) return;
  li.value = String(Math.round(cost / here.price * 100) / 100).replace('.', ','); li.dataset.auto = '1';
  updateCalc();
}
$('f-cost').addEventListener('input', () => fillLiterFromPrice(false));
$('f-liter').addEventListener('input', () => { $('f-liter').dataset.auto = ''; });

/* Koordinaten für den Telegram-Alarm */
$('alarmPos').onclick = async () => {
  const out = $('alarmPosOut');
  try {
    const p = prefs.pLoc && !prefs.pLoc.gps ? prefs.pLoc : await getPosition();
    const lat = p.lat.toFixed(3), lng = p.lng.toFixed(3);
    out.innerHTML = `ALARM_LAT = <b>${lat}</b><br>ALARM_LNG = <b>${lng}</b><br><button class="linkbtn" type="button" id="alarmCopy">Kopieren</button>`;
    out.hidden = false;
    $('alarmCopy').onclick = () => navigator.clipboard?.writeText(`ALARM_LAT=${lat}\nALARM_LNG=${lng}`).then(() => toast('Kopiert ✓'), () => toast('Bitte von Hand abschreiben'));
  } catch (e) { out.textContent = e.message + ' – du kannst auch unter „Spritpreise“ einen Ort suchen.'; out.hidden = false; }
};
$('list').addEventListener('click', e => { const b = e.target.closest('.entry'); if (b) openSheet(entries.find(x => x.id === b.dataset.id)); });

$('form').addEventListener('submit', ev => {
  ev.preventDefault();
  const cost = parseNum($('f-cost').value);
  if (!(cost > 0)) { $('f-cost').focus(); return toast(kind === 'fuel' ? 'Bitte den Betrag vom Bon eingeben' : 'Bitte einen Betrag eingeben'); }
  const old = editId && entries.find(x => x.id === editId);
  const base = { id: editId || uid(), date: $('f-date').value || today(), cost, car: $('f-car').value || prefs.car,
    note: $('f-note').value.trim(), created: old ? old.created : Date.now(), type: kind };
  let e;
  if (kind === 'fuel') {
    const v = parseNum($('f-dist').value), liter = parseNum($('f-liter').value);
    if (v == null || !(v >= 0)) { $('f-dist').focus(); return toast(mode === 'km' ? 'Bitte gefahrene km eingeben' : 'Bitte Tachostand eingeben'); }
    if (Number.isNaN(liter) || liter < 0) return toast('Liter bitte als Zahl eingeben');
    e = { ...base, liter, km: mode === 'km' ? v : null,
      odo: mode === 'odo' ? v : (old ? old.odo ?? null : null) };  // Tachostand beim Bearbeiten nicht verlieren
    if (!old) { prefs.mode = mode; savePrefs(); }
  } else e = { ...base, cat };
  entries = entries.filter(x => x.id !== e.id).concat(e);
  save();
  selectedYear = +e.date.slice(0, 4);
  if (e.car !== prefs.car) { prefs.car = e.car; savePrefs(); }
  closeSheet(); render();
  toast(old ? 'Eintrag geändert ✓' : 'Gespeichert ✓');
});
$('delBtn').onclick = async () => {
  if (!await ask('Diesen Eintrag wirklich löschen?', { ok: 'Löschen', danger: true })) return;
  entries = entries.filter(x => x.id !== editId); save(); closeSheet(); render(); toast('Gelöscht');
};

/* ---------- Bon scannen (Texterkennung mit Tesseract.js) ---------- */
let tessLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return tessLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
    s.integrity = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F'; s.crossOrigin = 'anonymous';
    s.onload = res; s.onerror = () => { tessLoading = null; rej(new Error('load')); };
    document.head.appendChild(s);
  });
}
function resetScan() { $('scanBtn').classList.remove('busy'); $('scanTitle').textContent = 'Bon fotografieren'; $('scanSub').textContent = 'Betrag, Liter und Datum werden ausgelesen'; $('scanProg').style.width = '0'; }
function scanStatus(t, sub, pct) { $('scanTitle').textContent = t; $('scanSub').textContent = sub; if (pct != null) $('scanProg').style.width = pct + '%'; }

// Foto verkleinern und in Graustufen umwandeln – schneller und zuverlässiger
async function prepareImage(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const sc = Math.min(1, 1800 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
  const g = c.getContext('2d'); g.filter = 'grayscale(1) contrast(1.4)'; g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return c;
}

// Text eines Tankbons auswerten
function parseReceipt(text) {
  const t = text.replace(/[|]/g, ' ').replace(/(\d)\s*[,.]\s*(\d)/g, '$1,$2');
  const lines = t.split(/\n/).map(l => l.trim()).filter(Boolean);
  const money = s => { const m = s.match(/(\d{1,4},\d{2})(?!\d)/g); return m ? m.map(x => parseNum(x)) : []; };
  const out = {};
  // Betrag: Zeile mit Summe/Gesamt/zu zahlen/Betrag …, sonst größter Betrag
  const keys = /(summe|gesamt|zu\s*zahlen|zahlbetrag|betrag|total|endsumme|bar|ec[- ]?karte|girocard|kartenzahlung)/i;
  for (const l of lines) if (keys.test(l) && !/mwst|ust|netto|steuer/i.test(l)) { const m = money(l); if (m.length) { out.cost = Math.max(...m); break; } }
  if (out.cost == null) { const all = lines.flatMap(money).filter(v => v < 500); if (all.length) out.cost = Math.max(...all); }
  // Literpreis, z. B. „1,789 EUR/l“ oder „1,789 €/Ltr“
  const pm = t.match(/(\d,\d{2,3})\s*(?:€|eur|euro)?\s*\/\s*(?:l|ltr|liter)\b/i);
  if (pm) out.price = parseNum(pm[1]);
  // Liter, z. B. „41,23 l“ oder „Menge 41,23“
  const lm = t.match(/(\d{1,3},\d{2,3})\s*(?:l|ltr|liter)\b(?!\s*\/)/i) || t.match(/(\d{1,3},\d{2,3})\s*[lI1|]\s*[x×*]/) || t.match(/menge[^\d]{0,12}(\d{1,3},\d{2,3})/i);
  if (lm) out.liter = parseNum(lm[1]);
  if (!out.liter && out.price && out.cost) out.liter = Math.round(out.cost / out.price * 100) / 100;
  // Datum, z. B. „13.11.2026“ oder „13.11.26“
  const dm = text.match(/\b(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{4}|\d{2})\b/);
  if (dm) { const y = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3], mo = +dm[2], d = +dm[1];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 2000 && y <= new Date().getFullYear() + 1) out.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  // Tankstellen-Name aus den ersten Zeilen
  const brand = t.match(/\b(aral|shell|esso|jet|total(?:energies)?|avia|agip|eni|omv|bp|star|hem|orlen|westfalen|raiffeisen|q1|tamoil|globus|famila|kaufland|oil!?)\b/i);
  if (brand) out.note = brand[1][0].toUpperCase() + brand[1].slice(1).toLowerCase();
  return out;
}

$('scanBtn').onclick = () => { if (!$('scanBtn').classList.contains('busy')) $('scanFile').click(); };
$('scanFile').onchange = async ev => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  $('scanBtn').classList.add('busy');
  try {
    scanStatus('Texterkennung wird geladen …', 'Beim ersten Mal kann das etwas dauern', 5);
    await loadTesseract();
    const canvas = await prepareImage(file);
    const { data } = await Tesseract.recognize(canvas, 'deu', {
      // alle Teile mit fester Version laden (sonst würde z. B. die Sprachdatei immer „die neueste“ sein)
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
      langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int',
      logger: m => { if (m.status === 'recognizing text') scanStatus('Bon wird gelesen …', Math.round(m.progress * 100) + ' %', 10 + m.progress * 90); }
    });
    const r = parseReceipt(data.text), f = v => String(v).replace('.', ',');
    const found = [];
    if (r.cost) { $('f-cost').value = f(r.cost.toFixed(2)); found.push('Betrag'); }
    if (r.liter) { $('f-liter').value = f(r.liter); found.push('Liter'); }
    if (r.date) { $('f-date').value = r.date; found.push('Datum'); }
    if (r.note && !$('f-note').value) $('f-note').value = r.note;
    updateCalc();
    $('scanBtn').classList.remove('busy');
    if (found.length) scanStatus('✓ ' + found.join(', ') + ' erkannt', 'Bitte kurz prüfen – noch einmal tippen zum Wiederholen', 100);
    else scanStatus('Nichts erkannt', 'Bon gerade und gut beleuchtet fotografieren', 0);
    $('f-dist').focus();
  } catch (err) {
    $('scanBtn').classList.remove('busy');
    scanStatus('Scannen nicht möglich', 'Dafür wird eine Internetverbindung gebraucht', 0);
  }
};

/* ---------- Termine & Erinnerungen ---------- */
const TERMS = 'tankbuch-termine';
// Name, Symbol, Monate, km, Kostenkategorie, feste Frist (nächster Termin ab der alten Frist statt ab heute)
const TPL = [
  ['Revision / Collaudo', '🔍', 24, null, 'revision', true], ['Kfz-Steuer (Bollo)', '🏛️', 12, null, 'steuer', true],
  ['Versicherung', '🛡️', 12, null, 'versicherung', true], ['Inspektion', '🧰', 12, 20000, 'werkstatt'], ['Ölwechsel', '🛢️', 12, 15000, 'werkstatt'],
  ['Reifenwechsel', '🛞', 6, null, 'reifen'], ['TÜV / HU (Deutschland)', '🔍', 24, null, 'werkstatt', true],
  ['Bremsen', '🛑', null, 40000, 'werkstatt'], ['Zahnriemen', '⚙️', null, 120000, 'werkstatt'], ['Eigener Termin', '📌', null, null, 'sonst']];
const TPL_ALIAS = { 'Kfz-Steuer': 'Kfz-Steuer (Bollo)', 'TÜV / HU': 'TÜV / HU (Deutschland)' };  // ältere Termine
const tplOf = title => TPL.find(x => x[0] === (TPL_ALIAS[title] || title)) || TPL[TPL.length - 1];
const TPL_TIP = {
  'Kfz-Steuer (Bollo)': '💡 Der Bollo ist in Italien meist bis zum Ende des Monats nach Ablauf zu zahlen. Trag als Datum den Ablauf ein.',
  'Versicherung': '💡 Tipp: Rechtzeitig vergleichen – viele Versicherungen kann man bis kurz vor Ablauf wechseln.',
};
const endOfMonth = d => { const x = new Date(d + 'T00:00'); return iso(new Date(x.getFullYear(), x.getMonth() + 1, 0)); };
// Revision in Italien: erste nach 4 Jahren ab Erstzulassung, dann alle 2 Jahre – bis Monatsende
function revisionDue(reg) {
  if (!/^\d{4}-\d\d$/.test(reg || '')) return null;
  let d = endOfMonth(addMonths(reg + '-01', 48));
  while (d < today()) d = endOfMonth(addMonths(d.slice(0, 8) + '01', 24));
  return d;
}
let terms = cleanList(read(TERMS, []), cleanTerm);
let termEdit = null, termTpl = 0;
const saveTerms = () => { if (window.syncReady) { stamp(); scheduleSync(); } if (window.tgReady) scheduleReminders(); return write(TERMS, terms) || toast('Speichern nicht möglich'); };
const addMonths = (d, m) => { const x = new Date(d + 'T00:00'); x.setMonth(x.getMonth() + m); return iso(x); };

// Kilometerstand schätzen: letzter bekannter Tachostand + seitdem gefahrene km
function currentOdo(carId) {
  const car = cars.find(c => c.id === carId) || {};
  let base = car.odo ? { odo: car.odo.value, date: car.odo.date, created: car.odo.at || 0 } : null;
  for (const e of fuelOf(carId)) if (e.odo != null && (!base || e.date > base.date || (e.date === base.date && e.created > base.created))) base = { odo: e.odo, date: e.date, created: e.created };
  if (!base) return null;
  let km = base.odo;
  for (const e of fuelOf(carId)) if (e.odo == null && e.km > 0 && (e.date > base.date || (e.date === base.date && e.created > base.created))) km += e.km;
  return Math.round(km);
}
// Status eines Termins: wie dringend?
function termState(t) {
  const out = { level: 0, text: '', sort: Infinity };
  const parts = [];
  if (t.due) {
    const days = Math.round((new Date(t.due + 'T00:00') - new Date(today() + 'T00:00')) / 864e5);
    out.sort = Math.min(out.sort, days);
    if (days < 0) { out.level = 2; parts.push(`seit ${-days} ${-days === 1 ? 'Tag' : 'Tagen'} fällig`); }
    else if (days === 0) { out.level = 2; parts.push('heute fällig'); }
    else { if (days <= 30) out.level = Math.max(out.level, 1); parts.push(days < 60 ? `in ${days} Tagen` : `am ${dmy(t.due)}`); }
  }
  if (t.dueKm) {
    const odo = currentOdo(t.car);
    if (odo != null) {
      const left = t.dueKm - odo;
      out.sort = Math.min(out.sort, left / 40);  // grob: 40 km pro Tag
      if (left <= 0) { out.level = 2; parts.push(`${num(-left)} km überfällig`); }
      else { if (left <= 1000) out.level = Math.max(out.level, 1); parts.push(`noch ${num(left)} km`); }
    } else parts.push(`bei ${num(t.dueKm)} km`);
  }
  out.text = parts.join(' · ') || 'ohne Datum';
  return out;
}
const termIcon = t => tplOf(t.title)[1];
function termRow(t) {
  const st = termState(t);
  const tag = st.level === 2 ? '<span class="tag bad">Fällig</span>' : st.level === 1 ? '<span class="tag warn">Bald</span>' : '<span class="tag">OK</span>';
  const rep = [t.everyMonths ? `alle ${t.everyMonths} Monate` : '', t.everyKm ? `alle ${num(t.everyKm)} km` : ''].filter(Boolean).join(' / ');
  return `<button class="due" data-t="${esc(t.id)}"><div class="em">${termIcon(t)}</div><div class="mid"><div class="t">${esc(t.title)}</div>
    <div class="s">${st.text}${rep ? ' · ↻ ' + rep : ''}${t.amount ? ' · ca. ' + eur(t.amount) : ''}</div></div>${tag}</button>`;
}
function renderTerms() {
  const mine = terms.filter(t => t.car === prefs.car).map(t => [t, termState(t)]).sort((a, b) => b[1].level - a[1].level || a[1].sort - b[1].sort);
  $('termCar').textContent = cars.length > 1 ? curCar().name : '';
  $('termList').innerHTML = mine.length ? mine.map(([t]) => termRow(t)).join('')
    : `<p class="note" style="margin:0">Lass dich an Revision (Collaudo), Bollo, Versicherung, Ölwechsel oder Reifenwechsel erinnern – nach Datum oder Kilometerstand.</p>`;
  $('dueCard').hidden = !mine.length;
  $('dueList').innerHTML = mine.slice(0, 3).map(([t]) => termRow(t)).join('');
  const urgent = mine.filter(([, st]) => st.level > 0);
  $('dueBanner').hidden = !urgent.length;
  if (urgent.length) {
    const [t, st] = urgent[0], bad = st.level === 2;
    $('dueBanner').classList.toggle('bad', bad);
    $('dueIc').textContent = bad ? '⚠️' : '🔔';
    $('dueText').innerHTML = `<b>${esc(t.title)} ${bad ? 'ist fällig' : 'steht bald an'}</b>${st.text}${urgent.length > 1 ? ` · und ${urgent.length - 1} weitere` : ''}`;
  }
}
function renderTpl() {
  $('tTpl').innerHTML = TPL.map((x, i) => `<button type="button" data-i="${i}" class="${i === termTpl ? 'on' : ''}">${x[1]} ${x[0]}</button>`).join('');
}
function odoHint() {
  const o = currentOdo(prefs.car);
  $('t-odoHint').textContent = o != null ? `Geschätzt aus deinen Einträgen: ${num(o)} km` : 'Noch kein Kilometerstand bekannt.';
}
function tplExtras() {
  const name = TPL[termTpl][0];
  $('t-regBox').hidden = name !== 'Revision / Collaudo';
  $('t-tip').hidden = !TPL_TIP[name]; $('t-tip').textContent = TPL_TIP[name] || '';
}
$('t-reg').addEventListener('input', () => {
  const d = revisionDue($('t-reg').value);
  if (d) { $('t-date').value = d; $('t-every').value = '24'; }
});
function openTerm(t) {
  termEdit = t ? t.id : null;
  $('tform').reset();
  termTpl = t ? TPL.indexOf(tplOf(t.title)) : 0;
  renderTpl();
  const f = t || { title: TPL[0][0], due: '', everyMonths: TPL[0][2] };
  $('t-reg').value = t && t.reg || ''; $('t-amount').value = t && t.amount ? String(t.amount).replace('.', ',') : '';
  tplExtras();
  $('t-name').value = f.title; $('t-date').value = f.due || ''; $('t-km').value = f.dueKm || '';
  $('t-every').value = f.everyMonths || ''; $('t-everykm').value = f.everyKm || '';
  const o = currentOdo(prefs.car); $('t-odo').value = o != null ? o : '';
  odoHint();
  $('tTitle').textContent = t ? 'Termin bearbeiten' : 'Neuer Termin';
  $('tDone').hidden = $('tDel').hidden = !t;
  document.body.classList.add('sheet-open'); $('tform').classList.add('open');
}
$('tTpl').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  termTpl = +b.dataset.i; renderTpl();
  const [name, , months, km] = TPL[termTpl], o = parseNum($('t-odo').value);
  $('t-name').value = termTpl === TPL.length - 1 ? '' : name;
  $('t-every').value = months || ''; $('t-everykm').value = km || '';
  $('t-date').value = TPL[termTpl][0] === 'Revision / Collaudo' ? (revisionDue($('t-reg').value) || '') : months ? addMonths(today(), months) : '';
  $('t-km').value = km && o ? o + km : '';
  tplExtras();
  if (termTpl === TPL.length - 1) $('t-name').focus();
};
function readTermForm() {
  const title = $('t-name').value.trim(), due = $('t-date').value || null;
  const dueKm = parseNum($('t-km').value), everyKm = parseNum($('t-everykm').value), every = +$('t-every').value || null, odo = parseNum($('t-odo').value);
  if (!title) { $('t-name').focus(); toast('Bitte eine Bezeichnung eingeben'); return null; }
  if (!due && !(dueKm > 0)) { toast('Bitte ein Datum oder einen km-Stand angeben'); return null; }
  if ([dueKm, everyKm, odo].some(Number.isNaN)) { toast('Kilometer bitte als Zahl eingeben'); return null; }
  const amount = parseNum($('t-amount').value);
  if (Number.isNaN(amount) || amount < 0) { toast('Betrag bitte als Zahl eingeben'); return null; }
  const reg = /^\d{4}-\d\d$/.test($('t-reg').value) && !$('t-regBox').hidden ? $('t-reg').value : null;
  return { title, due, dueKm: dueKm > 0 ? Math.round(dueKm) : null, everyMonths: every, everyKm: everyKm > 0 ? Math.round(everyKm) : null, odo, amount: amount || null, reg };
}
function rememberOdo(odo) {
  if (!(odo > 0)) return;
  const car = cars.find(c => c.id === prefs.car);
  if (car && odo !== currentOdo(car.id)) { car.odo = { value: Math.round(odo), date: today(), at: Date.now() }; save(); }
}
$('tform').addEventListener('submit', ev => {
  ev.preventDefault();
  const f = readTermForm(); if (!f) return;
  rememberOdo(f.odo); delete f.odo;
  const t = { id: termEdit || uid(), car: prefs.car, ...f };
  terms = terms.filter(x => x.id !== t.id).concat(t); saveTerms();
  closeSheet(); render(); toast('Termin gespeichert ✓');
});
$('tDone').onclick = async () => {
  const t = terms.find(x => x.id === termEdit); if (!t) return;
  const odo = parseNum($('t-odo').value); rememberOdo(odo);
  const o = currentOdo(t.car);
  const fixed = tplOf(t.title)[5];
  if (t.everyMonths || t.everyKm) {
    if (t.everyMonths && fixed && t.due) {
      // feste Frist (Revision, Bollo, Versicherung …): ab der alten Frist weiter, nicht ab heute
      let d = t.due; do { d = addMonths(d, t.everyMonths); } while (d <= today());
      t.due = tplOf(t.title)[0] === 'Revision / Collaudo' ? endOfMonth(d) : d;
    } else t.due = t.everyMonths ? addMonths(today(), t.everyMonths) : null;
    t.dueKm = t.everyKm && o != null ? o + t.everyKm : null;
    if (!t.due && !t.dueKm) t.due = addMonths(today(), 12);
  } else terms = terms.filter(x => x.id !== t.id);
  saveTerms(); closeSheet(); render();
  toast(t.everyMonths || t.everyKm ? 'Erledigt ✓ – nächster Termin ist eingetragen' : 'Erledigt ✓');
  const cat = tplOf(t.title)[4];
  if (await ask(`Möchtest du die Kosten für „${t.title}“ gleich eintragen?`, { ok: 'Kosten eintragen' })) {
    openSheet(); setKind('cost'); setCat(cat); $('f-note').value = t.title;
    if (t.amount) $('f-cost').value = String(t.amount.toFixed(2)).replace('.', ',');
  }
};
$('tDel').onclick = async () => {
  if (!await ask('Diesen Termin löschen?', { ok: 'Löschen', danger: true })) return;
  terms = terms.filter(x => x.id !== termEdit); saveTerms(); closeSheet(); render(); toast('Termin gelöscht');
};
$('tCal').onclick = () => {
  const f = readTermForm(); if (!f) return;
  if (!f.due) return toast('Für den Kalender wird ein Datum gebraucht');
  const d = f.due.replace(/-/g, '');
  const end = iso(new Date(new Date(f.due + 'T00:00').getTime() + 864e5)).replace(/-/g, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tankbuch//DE', 'BEGIN:VEVENT', `UID:${termEdit || uid()}@tankbuch`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${f.title} (${curCar().name})`, 'DESCRIPTION:Erinnerung aus dem Tankbuch',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + f.title, 'TRIGGER:-P7D', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + f.title, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  shareOrDownload(`${f.title.replace(/[^\wäöüÄÖÜß-]+/g, '-')}.ics`, ics, 'text/calendar');
};
$('tClose').onclick = closeSheet;
$('addTerm').onclick = () => openTerm();
$('termList').onclick = $('dueList').onclick = e => { const b = e.target.closest('.due'); if (b) openTerm(terms.find(x => x.id === b.dataset.t)); };
$('dueAll').onclick = $('dueOpen').onclick = () => { show('data'); openPage('terms'); };

/* ---------- Spritpreise (Tankerkönig / MTS-K) ---------- */
const PRICE_CACHE = 'tankbuch-preise';
const TYPES = { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' };
let priceState = read(PRICE_CACHE, null), priceBusy = false;
const priceFmt = p => { const s = num(p, 3); return `${s.slice(0, -1)}<sup>${s.slice(-1)}</sup>`; };
function lastPaid() {
  const l = fuelOf(prefs.car).filter(e => e.liter > 0);
  return l.length ? l[l.length - 1].cost / l[l.length - 1].liter : null;
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Standort wird nicht unterstützt'));
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => rej(new Error('Standort nicht freigegeben')), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });
}
// Italien (inkl. Südtirol): Tagespreise des Ministeriums (MIMIT), täglich per GitHub Action aufbereitet
const IT_DATA = 'https://raw.githubusercontent.com/LordGrim96/karte/carburanti-data/it/';
const inItaly = p => p && p.lat > 35.4 && p.lat < 47.1 && p.lng > 6.6 && p.lng < 18.6;
function distKm(a, b) {
  const R = 6371, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// für die Karte: die 30 günstigsten (plus die nächste), Standort nur grob (≈100 m) merken
function mapStations(all) {
  const sel = [...all].sort((a, b) => a.price - b.price || a.dist - b.dist).slice(0, 30);
  const near = [...all].sort((a, b) => a.dist - b.dist)[0];
  if (near && !sel.includes(near)) sel.push(near);
  return sel.map(x => ({ id: x.id || '', name: x.name, street: x.street, place: x.place, price: x.price, lat: x.lat, lng: x.lng, dist: x.dist, near: x === near }));
}
const roughPos = p => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });
// die 5 günstigsten – und die nächstgelegene Tankstelle, falls sie nicht schon dabei ist
function pickStations(all) {
  const cheap = [...all].sort((a, b) => a.price - b.price || a.dist - b.dist).slice(0, 5);
  const near = [...all].sort((a, b) => a.dist - b.dist)[0];
  if (near && !cheap.includes(near)) cheap.push({ ...near, nearest: true });
  else if (near) near.nearest = true;
  return cheap;
}
// Cloudflare-Adresse prüfen: nur https://….workers.dev ohne Pfad
const PROXY_DEFAULT = 'https://tankbuch-proxy.edengrim67.workers.dev';  // Cloudflare-Worker aus cloudflare/tankbuch-proxy.js
// fest eingetragen – die Sicherheitsregeln (CSP) erlauben nur diesen einen Worker
const proxyUrl = () => PROXY_DEFAULT;

// Kacheln von GitHub (täglich aufbereitet) – null, wenn nicht vorhanden oder älter als 2 Tage
async function italyTiles(pos, rad) {
  let m;
  try { m = await fetch(IT_DATA + 'meta.json', { cache: 'no-cache' }); } catch { return null; }
  if (!m.ok) return null;
  const meta = await m.json();
  if (!meta.updated || Date.now() - new Date(meta.updated.replace('Z', ':00Z')) > 2 * 864e5) return null;
  const dLat = rad / 111, dLng = rad / (111 * Math.cos(pos.lat * Math.PI / 180)), keys = [];
  for (let la = Math.floor(pos.lat - dLat); la <= Math.floor(pos.lat + dLat); la++)
    for (let lo = Math.floor(pos.lng - dLng); lo <= Math.floor(pos.lng + dLng); lo++) keys.push(`${la}_${lo}`);
  const tiles = await Promise.all(keys.map(k => fetch(IT_DATA + k + '.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : r.status === 404 ? [] : Promise.reject(new Error('Preise für Italien nicht erreichbar')))));
  return { items: tiles.flat(), updated: meta.updated };
}

// Direkt über den Cloudflare-Zwischendienst: beide CSV-Dateien laden und hier auswerten.
// Gespeichert wird nur die Umgebung (100 km) – einmal pro Tag neu.
const IT_LOCAL = 'tankbuch-it-lokal';
function csvRows(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const h = lines.findIndex((l, i) => i < 5 && /^idimpianto/i.test(l));
  if (h < 0) throw new Error('Unerwartetes Dateiformat vom Ministerium');
  const sep = (lines[h].match(/\|/g) || []).length > (lines[h].match(/;/g) || []).length ? '|' : ';';
  return lines.slice(h + 1).map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
}
const cap = v => String(v || '').toLowerCase().replace(/(^|[\s'(-])\S/g, c => c.toUpperCase());
async function italyViaProxy(pos) {
  const base = proxyUrl();
  if (!base) return null;
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const cached = read(IT_LOCAL, null);
  if (cached && cached.day === day && distKm(pos, cached.center) < 40 && Date.now() - cached.at < 12 * 36e5) return cached;
  const get = f => fetch(`${base}/${f}`).then(r => r.ok ? r.text() : r.text().then(t => Promise.reject(new Error(t.slice(0, 120) || 'Zwischendienst-Fehler ' + r.status))));
  const [stTxt, prTxt] = await Promise.all([get('anagrafica_impianti_attivi.csv'), get('prezzo_alle_8.csv')]);
  const near = new Map(), R = 100, dLat = R / 111, dLng = R / (111 * Math.cos(pos.lat * Math.PI / 180));
  for (const r of csvRows(stTxt)) {
    if (r.length < 10) continue;
    const lat = parseFloat(String(r[r.length - 2]).replace(',', '.')), lng = parseFloat(String(r[r.length - 1]).replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat - pos.lat) > dLat || Math.abs(lng - pos.lng) > dLng) continue;
    const brand = /^pompe bianche$/i.test(r[2]) ? '' : r[2];
    near.set(r[0], { id: r[0], n: cap(r[4] || r[1]).slice(0, 60), br: cap(brand).slice(0, 30), a: cap(r.slice(5, -4).join(' ')).slice(0, 80),
      c: cap(r[r.length - 4]).slice(0, 40), lat, lng, p: {} });
  }
  const fuels = { benzina: 'b', gasolio: 'd' }, oldest = Date.now() - 14 * 864e5;
  for (const r of csvRows(prTxt)) {
    const st = near.get(r[0]), key = fuels[String(r[1]).toLowerCase()];
    if (!st || !key || r.length < 5) continue;
    const price = parseFloat(String(r[2]).replace(',', '.')), m = String(r[4]).match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (!(price > 0.5 && price < 4) || !m) continue;
    const when = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;
    if (new Date(when) < oldest) continue;
    const slot = st.p[key] ||= [null, null, when], i = r[3] === '1' ? 0 : 1;
    if (slot[i] == null || price < slot[i]) slot[i] = price;
    if (when > slot[2]) slot[2] = when;
  }
  const items = [...near.values()].filter(x => Object.keys(x.p).length);
  if (!items.length) throw new Error('Keine Tankstellen mit Preisen in der Umgebung gefunden');
  const out = { day, at: Date.now(), center: { lat: pos.lat, lng: pos.lng }, items, updated: new Date().toISOString().slice(0, 16) + 'Z' };
  write(IT_LOCAL, out);
  return out;
}

async function loadItaly(pos) {
  const rad = prefs.pRad;
  const data = await italyTiles(pos, rad) || await italyViaProxy(pos);
  if (!data) throw new Error(proxyUrl() ? 'Preise für Italien nicht erreichbar' :
    'Die Preise für Italien sind noch nicht bereit. Tipp: unter „Mehr“ den Cloudflare-Zwischendienst eintragen.');
  const fuel = prefs.pType === 'diesel' ? 'd' : 'b';
  const stations = data.items.map(x => {
    const p = x.p && x.p[fuel]; if (!p) return null;
    const price = p[0] || p[1], dist = distKm(pos, x);
    return dist <= rad && +price > 0 && Number.isFinite(dist) ? { id: safeId(x.id), name: txt(x.br || x.n, 60), street: txt(x.a, 80), place: txt(x.c, 40), dist, price: +price, self: !!p[0], when: isoOrNull(String(p[2] || '').slice(0, 10)), lat: +x.lat, lng: +x.lng } : null;
  }).filter(Boolean);
  return { stations: pickStations(stations), map: mapStations(stations), updated: data.updated };
}
async function loadPrices(force = false) {
  if (!prefs.pLoc || priceBusy) return renderPrices();
  if (!force && priceState && priceState.at && Date.now() - priceState.at < 10 * 60e3 && priceState.type === prefs.pType && priceState.rad === prefs.pRad) return renderPrices();
  priceBusy = true; renderPrices();
  try {
    let pos = prefs.pLoc;
    if (pos.gps) pos = await getPosition();
    if (inItaly(pos)) {
      priceState = { at: Date.now(), type: prefs.pType, rad: prefs.pRad, country: 'it', ...(await loadItaly(pos)), error: null, pos: roughPos(pos) };
      throw null;  // fertig – überspringt die deutsche Abfrage
    }
    if (!prefs.pKey) throw new Error('Für Deutschland wird ein Tankerkönig-Schlüssel gebraucht (unter „Mehr“)');
    const u = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${pos.lat.toFixed(3)}&lng=${pos.lng.toFixed(3)}&rad=${Math.min(25, prefs.pRad)}&sort=dist&type=${prefs.pType}&apikey=${encodeURIComponent(prefs.pKey)}`;
    const r = await fetch(u), j = await r.json();
    if (!j.ok) throw new Error(j.message || 'Abfrage fehlgeschlagen');
    const st = ((j.stations || []).filter(x => x.isOpen && x.price > 0)
      .map(x => ({ name: txt(x.brand || x.name, 60), street: txt([x.street, x.houseNumber].filter(Boolean).join(' '), 80), place: txt(x.place, 40), dist: +x.dist, price: +x.price, lat: +x.lat, lng: +x.lng }))
      .filter(x => [x.dist, x.price, x.lat, x.lng].every(Number.isFinite)));
    priceState = { at: Date.now(), type: prefs.pType, rad: prefs.pRad, country: 'de', stations: pickStations(st), map: mapStations(st), error: null, pos: roughPos(pos) };
  } catch (e) {
    if (e === null) { write(PRICE_CACHE, priceState); priceBusy = false; return renderPrices(); }
    priceState = { ...(priceState || {}), error: /fetch|network|load/i.test(e.message) ? 'Keine Verbindung zu den Spritpreisen' : e.message };
  }
  write(PRICE_CACHE, priceState);
  priceBusy = false; renderPrices();
}
let priceKey = '';
function renderPrices() {
  const box = $('priceNow');
  // nichts geändert → Karte nicht neu aufbauen (spart viel Zeit bei jedem Speichern)
  const key = JSON.stringify([!!prefs.pLoc, priceBusy, priceState && priceState.at, priceState && priceState.error, prefs.pType, prefs.accent, lastPaid()]);
  if (key === priceKey && box.childElementCount) return;
  priceKey = key;
  if (!prefs.pLoc) {
    box.innerHTML = `<h2>⛽ Wo ist es gerade günstig?</h2><p class="note" style="margin:0 0 12px">Zeig dir die aktuell günstigsten Tankstellen in deiner Nähe – live aus dem Internet.</p>
      <button class="btn sec full" id="pSetupBtn">Spritpreise einrichten</button>`;
    $('pSetupBtn').onclick = () => { show('data'); openPage('prices'); };
    return;
  }
  const s = priceState, list = s && s.type === prefs.pType ? s.stations || [] : [];
  const paid = lastPaid(), best = list[0];
  let hint = '';
  if (best && paid) {
    const d = (paid - best.price) * 100;
    hint = `<div class="hint">${d >= 0.5 ? `💡 <b>${num(d, 0)} ct/l günstiger</b> als dein letztes Tanken (${num(paid, 3)} €) – bei 40 l sparst du ca. ${eur(d * 0.4)}.`
      : d <= -0.5 ? `📈 Gerade <b>${num(-d, 0)} ct/l teurer</b> als bei deinem letzten Tanken – wenn möglich noch warten.` : `Etwa gleich teuer wie dein letztes Tanken.`}</div>`;
  }
  const hour = new Date().getHours();
  const tip = (s && s.country === 'it') ? '' : hour >= 6 && hour < 12 ? `<div class="hint" style="background:var(--amber-soft)">⏰ Morgens ist Sprit meist am teuersten. Abends zwischen 18 und 22 Uhr ist es oft deutlich günstiger.</div>` : '';
  const where = prefs.pLoc.gps ? 'in deiner Nähe' : `bei ${esc(prefs.pLoc.label || 'deinem Ort')}`;
  const it = s && s.country === 'it';
  const typeName = it ? (prefs.pType === 'diesel' ? 'Diesel (Gasolio)' : 'Benzin (Benzina)') : TYPES[prefs.pType];
  // Karte allein reicht – die Liste gibt es nur noch als Ersatz, falls die Karte nicht lädt
  const hasMap = list.length && s.map && s.map.length;
  box.innerHTML = `<h2>⛽ Günstig tanken <small>${it ? '🇮🇹 ' : ''}${typeName} · ${where}</small></h2>${hint}${tip}
    ${hasMap ? `<div class="pmap-wrap" id="pmapWrap"><div class="pmap" id="pmap" role="img" aria-label="Karte der Tankstellen"></div>
      <button class="pmap-btn" id="pmapBig" type="button">⤢ Groß</button></div>` : ''}
    <div id="pList"${hasMap ? ' hidden' : ''}>${list.length ? list.map((x, i) => `<a class="st${i ? '' : ' best'}" href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}" target="_blank" rel="noopener">
      <div class="n">${esc(x.name)}${i ? '' : '<span class="badge">am günstigsten</span>'}${x.nearest ? '<span class="badge">am nächsten</span>' : ''}</div><div class="p">${priceFmt(x.price)}</div>
      <div class="a">${esc(x.street)}, ${esc(x.place)} · ${num(x.dist, 1)} km${it ? (x.self ? ' · Self' : ' · bedient') + (x.when ? ' · ' + dmy(x.when).slice(0, -5) : '') : ''}</div></a>`).join('')
      : `<p class="note" style="margin:0">${priceBusy ? 'Preise werden geladen …' : s && s.error ? '⚠️ ' + esc(s.error) : `Keine geöffnete Tankstelle mit aktuellem Preis im Umkreis von ${it ? prefs.pRad : Math.min(25, prefs.pRad)} km gefunden. Umkreis unter „Mehr“ vergrößern.`}</p>`}</div>
    <div class="small"><span>${s && s.at ? 'Stand ' + new Date(s.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + (s.error && list.length ? ' · ⚠️ ' + esc(s.error) : '') : ''}${priceBusy ? ' · lädt …' : ''}</span>
      <button class="linkbtn" id="pRefresh">↻ Aktualisieren</button></div>
    <div class="small" style="margin-top:4px"><span>${it ? `Daten: MIMIT Osservaprezzi (IODL 2.0)${s.updated ? ', Stand ' + dmy(s.updated.slice(0, 10)) : ''}` : 'Daten: MTS-K via Tankerkönig (CC BY 4.0)'} · ${hasMap ? 'Preisschild antippen für Details und Route' : 'Antippen öffnet die Route'}</span></div>`;
  $('pRefresh').onclick = () => loadPrices(true);
  if ($('pmap')) drawMap(s);
}
/* Karte (Leaflet + OpenStreetMap), wird nur bei Bedarf geladen */
let leafletP = null, pmap = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return leafletP ||= new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    css.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H'; css.crossOrigin = 'anonymous';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
    js.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH'; js.crossOrigin = 'anonymous';
    js.onload = res; js.onerror = () => { leafletP = null; rej(new Error('Karte nicht verfügbar')); };
    document.head.appendChild(js);
  });
}
async function drawMap(s) {
  try { await loadLeaflet(); } catch { $('pmapWrap')?.remove(); if ($('pList')) $('pList').hidden = false; return; }
  const el = $('pmap'); if (!el || el._leaflet_id) return;
  if (pmap) { pmap.remove(); pmap = null; }
  const small = { dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomControl: false };
  pmap = L.map(el, { ...small, attributionControl: true, tap: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(pmap);
  const pts = [], extras = L.layerGroup();
  const cheapest = Math.min(...s.map.map(x => x.price));
  // kleine Karte: nur die 5 günstigsten + die nächste; groß: alle (bis 30)
  const top = new Set([...s.map].sort((a, b) => a.price - b.price).slice(0, 5));
  for (const x of s.map) {
    if (![x.lat, x.lng, x.price].every(Number.isFinite)) continue;
    const cls = 'pm' + (x.price === cheapest ? ' best' : '') + (x.near ? ' near' : '');
    const m = L.marker([x.lat, x.lng], { icon: L.divIcon({ className: cls, html: `<span>${num(x.price, 3)}</span>`, iconSize: null }),
      zIndexOffset: x.price === cheapest ? 1000 : x.near ? 500 : 0, keyboard: false });
    m.bindPopup(`<b>${esc(x.name)}</b><br>${esc(x.street)}, ${esc(x.place)}<br>${num(x.price, 3)} €/l · ${num(x.dist, 1)} km${x.near ? ' · am nächsten' : ''}<br>${histPopup(x.id)}
      <a href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}" target="_blank" rel="noopener">Route ›</a>`);
    if (top.has(x) || x.near) { m.addTo(pmap); pts.push([x.lat, x.lng]); } else m.addTo(extras);
  }
  if (s.pos && Number.isFinite(s.pos.lat)) {
    L.circleMarker([s.pos.lat, s.pos.lng], { radius: 7, weight: 3, color: '#fff', fillColor: '#2f6fd6', fillOpacity: 1 }).bindPopup('Dein Standort').addTo(pmap);
    pts.push([s.pos.lat, s.pos.lng]);
  }
  pmap.fitBounds(pts, { padding: [28, 28], maxZoom: 15 });
  const setBig = big => {
    $('pmapWrap').classList.toggle('big', big);
    document.body.classList.toggle('map-open', big);
    big ? extras.addTo(pmap) : extras.remove();
    $('pmapBig').textContent = big ? '✕ Schließen' : '⤢ Groß';
    for (const h of ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom']) big ? pmap[h].enable() : pmap[h].disable();
    if (big && !pmap.zoomControl) pmap.zoomControl = L.control.zoom({ position: 'bottomright' }).addTo(pmap);
    else if (!big && pmap.zoomControl) { pmap.zoomControl.remove(); pmap.zoomControl = null; }
    setTimeout(() => { pmap.invalidateSize(); pmap.fitBounds(pts, { padding: [36, 36], maxZoom: 15 }); }, 60);
  };
  $('pmapBig').onclick = () => setBig(!$('pmapWrap').classList.contains('big'));
}

// Einstellungen
function renderPriceSetup() {
  document.querySelectorAll('#pType button').forEach(b => b.classList.toggle('on', b.dataset.p === prefs.pType));
  document.querySelectorAll('#pRad button').forEach(b => b.classList.toggle('on', +b.dataset.r === +prefs.pRad));
  $('pLoc').textContent = !prefs.pLoc ? 'Noch kein Ort gewählt.' : prefs.pLoc.gps ? '📍 Es wird immer dein aktueller Standort verwendet.' : `📍 ${prefs.pLoc.label}`;
  try { renderMore(); } catch { /* beim Start noch nicht bereit */ }
  try { renderHistory(); } catch { /* beim Start noch nicht bereit */ }
}
$('pType').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.pType = b.dataset.p; savePrefs(); renderPriceSetup(); };
$('pRad').onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs.pRad = +b.dataset.r; savePrefs(); renderPriceSetup(); };
$('pGps').onclick = async () => {
  try { await getPosition(); prefs.pLoc = { gps: true }; savePrefs(); renderPriceSetup(); toast('Standort wird verwendet ✓'); }
  catch (e) { toast(e.message + ' – du kannst stattdessen einen Ort eingeben', 3500); }
};
$('pFind').onclick = async () => {
  const q = $('pPlace').value.trim(); if (!q) return $('pPlace').focus();
  try {
    // Nominatim-Regeln: App muss erkennbar sein (Referrer) und darf nur selten fragen (nur auf Knopfdruck)
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de,it&accept-language=de&q=${encodeURIComponent(q)}`, { referrerPolicy: 'strict-origin' });
    const j = await r.json();
    if (!j.length) return toast('Ort nicht gefunden');
    prefs.pLoc = { lat: +j[0].lat, lng: +j[0].lon, label: j[0].display_name.split(',').slice(0, 2).join(',').trim() };
    savePrefs(); renderPriceSetup(); toast('Ort gespeichert ✓');
  } catch { toast('Ortssuche nicht möglich – keine Verbindung'); }
};
$('pSave').onclick = () => {
  prefs.pKey = $('pKey').value.trim(); savePrefs();
  if (!prefs.pLoc) return toast('Bitte einen Ort suchen oder den Standort freigeben');
  if (!prefs.pKey && !prefs.pLoc.gps && !inItaly(prefs.pLoc)) return toast('Für Deutschland bitte den Tankerkönig-Schlüssel eintragen');
  priceState = null; show('home'); loadPrices(true);
};

/* ---------- Fahrzeuge ---------- */
$('addCar').onclick = async () => {
  const name = await ask('Name des Fahrzeugs (z. B. „Golf“ oder „Wohnmobil“):', { input: '', ok: 'Hinzufügen' });
  if (!name) return;
  const c = { id: uid(), name }; cars.push(c); prefs.car = c.id; savePrefs(); save(); selMonth = null; render();
  toast(`${name} hinzugefügt`);
};
$('cars').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.sel) { prefs.car = b.dataset.sel; savePrefs(); render(); return; }
  if (b.dataset.ren) {
    const c = cars.find(x => x.id === b.dataset.ren);
    const name = await ask('Neuer Name:', { input: c.name, ok: 'Speichern' }); if (!name) return;
    c.name = name; save(); render(); return;
  }
  if (b.dataset.del) {
    const c = cars.find(x => x.id === b.dataset.del), n = entries.filter(x => x.car === c.id).length;
    if (!await ask(`„${c.name}“ ${n ? `und alle ${n} Einträge ` : ''}wirklich löschen?`, { ok: 'Löschen', danger: true })) return;
    cars = cars.filter(x => x.id !== c.id); entries = entries.filter(x => x.car !== c.id); terms = terms.filter(x => x.car !== c.id); saveTerms();
    if (prefs.car === c.id) prefs.car = cars[0].id;
    savePrefs(); save(); render(); toast('Fahrzeug gelöscht');
  }
};

/* ---------- Sicherung ---------- */
async function shareOrDownload(name, text, type) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ files: [file], title: name }); return true;
    }
  } catch (e) { if (e && e.name === 'AbortError') return false; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
async function backup() {
  const ok = await shareOrDownload(`tankbuch-${today()}.json`, JSON.stringify({ app: 'tankbuch', version: 3, cars, entries, terms }, null, 1), 'application/json');
  if (ok) { prefs.lastBackup = today(); prefs.snooze = null; savePrefs(); render(); toast('Sicherung gespeichert ✓'); }
}
$('exportJson').onclick = $('bannerSave').onclick = backup;
$('bannerLater').onclick = () => { const d = new Date(); d.setDate(d.getDate() + 7); prefs.snooze = iso(d); savePrefs(); renderBackup(); };
$('remind').onchange = e => { prefs.remind = e.target.checked; savePrefs(); renderBackup(); };
$('exportCsv').onclick = () => {
  const d = v => v == null ? '' : String(v).replace('.', ','), q = s => '"' + String(s || '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""') + '"';
  const lines = ['Fahrzeug;Datum;Art;Kategorie;Betrag €;gefahrene km;Tachostand;Liter;€ pro Liter;Notiz'];
  for (const c of cars) {
    const fuel = fuelOf(c.id);
    for (const e of entries.filter(x => x.car === c.id).sort(byDate))
      lines.push([q(c.name), e.date, e.type === 'fuel' ? 'Tanken' : 'Kosten', e.type === 'cost' ? catOf(e.cat)[1] : '', d(e.cost),
        e.type === 'fuel' ? d(kmOf(e, fuel)) : '', d(e.odo), d(e.liter), e.liter ? d((e.cost / e.liter).toFixed(3)) : '', q(e.note)].join(';'));
  }
  shareOrDownload('tankbuch.csv', '﻿' + lines.join('\r\n'), 'text/csv');
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async ev => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const data = Array.isArray(raw) ? raw : raw.entries, inCars = Array.isArray(raw) ? [] : (raw.cars || []);
    if (!Array.isArray(data)) throw 0;
    for (const c of cleanList(inCars, cleanCar)) if (!cars.some(x => x.id === c.id)) cars.push(c);
    const inTerms = cleanList(raw.terms, cleanTerm).filter(t => !terms.some(x => x.id === t.id));
    if (inTerms.length) { terms = terms.concat(inTerms); saveTerms(); }
    const ids = new Set(entries.map(e => e.id));
    const neu = cleanList(data, cleanEntry).filter(e => !ids.has(e.id)).map(e => ({ ...e, car: cars.some(c => c.id === e.car) ? e.car : cars[0].id }));
    entries = entries.concat(neu); save(); render();
    toast(`${neu.length} Einträge übernommen`);
  } catch { toast('Datei konnte nicht gelesen werden'); }
};

/* ---------- Jahresbericht (über Drucken → „Als PDF sichern“) ---------- */
function buildReport() {
  const y = selectedYear, s = stats(y), p = stats(y - 1), fuel = fuelOf(prefs.car);
  const kp = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  const list = entries.filter(e => e.car === prefs.car && +e.date.slice(0, 4) === y).sort(byDate);
  let h = `<h1>Tankbuch – Jahresbericht ${y}</h1><div class="sub">${esc(curCar().name)} · erstellt am ${dmy(today())}</div>
  <div class="kp">${kp(eur(s.total), 'Autokosten gesamt')}${kp(eur(s.cost), 'davon Tanken')}${kp(num(s.km) + ' km', 'gefahren')}
    ${kp(s.per100 != null ? eur(s.per100) : '–', 'Sprit pro 100 km')}${kp(s.perLiter ? eur(s.perLiter) : '–', 'Ø Preis pro Liter')}
    ${kp(s.cons ? num(s.cons, 1) + ' l' : '–', 'Verbrauch / 100 km')}${kp(num(s.liter, 1) + ' l', 'getankt')}${kp(s.n, 'Tankvorgänge')}</div>`;
  if (p.n || p.otherN) h += `<h2>Vergleich zum Vorjahr</h2><table><tr><th></th><th>${y - 1}</th><th>${y}</th><th>Veränderung</th></tr>` +
    [['Tankkosten', p.cost, s.cost, eur], ['Weitere Kosten', p.other, s.other, eur], ['Gefahrene km', p.km, s.km, v => num(v)],
     ['€ / 100 km', p.per100, s.per100, eur], ['Ø € / Liter', p.perLiter, s.perLiter, eur], ['l / 100 km', p.cons, s.cons, v => num(v, 1)]]
      .map(([l, a, b, f]) => `<tr><td>${l}</td><td>${a != null ? f(a) : '–'}</td><td>${b != null ? f(b) : '–'}</td><td>${a && b != null ? (b >= a ? '+' : '') + num((b - a) / a * 100, 1) + ' %' : '–'}</td></tr>`).join('') + '</table>';
  h += `<h2>Monate</h2><table><tr><th>Monat</th><th>Tankkosten</th><th>km</th><th>€ / 100 km</th><th>Tankvorgänge</th></tr>` +
    s.months.map((m, i) => m.n ? `<tr><td>${MONTHS_LONG[i]}</td><td>${eur(m.cost)}</td><td>${num(m.km)}</td><td>${m.km ? eur(m.kmCost / m.km * 100) : '–'}</td><td>${m.n}</td></tr>` : '').join('') +
    `<tr class="sum"><td>Summe</td><td>${eur(s.cost)}</td><td>${num(s.km)}</td><td>${s.per100 != null ? eur(s.per100) : '–'}</td><td>${s.n}</td></tr></table>`;
  if (s.otherN) h += `<h2>Weitere Autokosten</h2><table><tr><th>Kategorie</th><th>Betrag</th></tr>` +
    CATS.filter(c => s.cats[c[0]]).map(c => `<tr><td>${c[1]}</td><td>${eur(s.cats[c[0]])}</td></tr>`).join('') +
    `<tr class="sum"><td>Summe</td><td>${eur(s.other)}</td></tr></table>`;
  h += `<h2>Alle Einträge</h2><table><tr><th>Datum</th><th>Art</th><th>Betrag</th><th>km</th><th>Liter</th><th>€/l</th><th>Notiz</th></tr>` +
    list.map(e => `<tr><td>${dmy(e.date)}</td><td>${e.type === 'fuel' ? 'Tanken' : catOf(e.cat)[1]}</td><td>${eur(e.cost)}</td>
      <td>${e.type === 'fuel' && kmOf(e, fuel) != null ? num(kmOf(e, fuel)) : ''}</td><td>${e.liter ? num(e.liter, 2) : ''}</td>
      <td>${e.liter ? num(e.cost / e.liter, 3) : ''}</td><td>${esc(e.note || '')}</td></tr>`).join('') + '</table>';
  h += `<div class="foot">Erstellt mit dem Tankbuch</div>`;
  $('report').innerHTML = h;
}
function printReport() {
  buildReport();
  const t = document.title; document.title = `Tankbuch ${selectedYear} – ${curCar().name}`;
  toast('Im Druckmenü „Als PDF sichern“ wählen', 3500);
  setTimeout(() => { window.print(); document.title = t; }, 300);
}
$('pdfBtn').onclick = $('pdfBtn2').onclick = printReport;

applyTheme();
$('pKey').value = prefs.pKey || '';
$('pKey').onchange = () => { prefs.pKey = $('pKey').value.trim(); savePrefs(); };
renderPriceSetup();
render();
// Karte schon mal im Hintergrund vorbereiten, während Standort und Preise geladen werden
if (prefs.pLoc) setTimeout(() => loadLeaflet().catch(() => {}), 0);
loadPrices();

/* ---------- Preisverlauf (vom Worker jeden Morgen gesammelt) ---------- */
let hist = read('tankbuch-verlauf', null);
async function loadHistory() {
  if (!prefs.pLoc) return;
  if (hist && Date.now() - (hist.fetched || 0) < 3 * 36e5) return renderHistory();
  try {
    const r = await fetch(PROXY_DEFAULT + '/history');
    if (!r.ok) return;
    const j = await r.json();
    if (!j || typeof j.stations !== 'object') return;
    hist = { fetched: Date.now(), stations: {} };
    for (const [id, st] of Object.entries(j.stations).slice(0, 60)) {       // bereinigen
      const p = {};
      for (const f of ['b', 'd']) p[f] = (Array.isArray(st.p && st.p[f]) ? st.p[f] : []).filter(e => Array.isArray(e) && isoOrNull(e[0]) && +e[1] > 0).map(e => [e[0], +e[1]]).slice(-120);
      hist.stations[safeId(id)] = { n: txt(st.n, 60), a: txt(st.a, 90), p };
    }
    write('tankbuch-verlauf', hist); renderHistory();
  } catch { /* ohne Netz: alter Stand */ }
}
const hfuel = () => prefs.pType === 'diesel' ? 'd' : 'b';
function spark(pts) {
  if (pts.length < 2) return '<svg viewBox="0 0 84 34"></svg>';
  const v = pts.map(p => p[1]), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 0.01;
  const xy = pts.map((p, i) => [i / (pts.length - 1) * 80 + 2, 30 - (p[1] - lo) / span * 26]);
  const last = xy[xy.length - 1];
  return `<svg viewBox="0 0 84 34" aria-hidden="true"><polyline points="${xy.map(q => q.map(n => n.toFixed(1)).join(',')).join(' ')}"/><circle r="3" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}"/></svg>`;
}
function renderHistory() {
  if (!hist || !hist.stations) return;
  const f = hfuel();
  const rows = Object.values(hist.stations).map(st => ({ st, pts: (st.p[f] || []).slice(-30) })).filter(r => r.pts.length)
    .sort((a, b) => a.pts[a.pts.length - 1][1] - b.pts[b.pts.length - 1][1]).slice(0, 5);
  const days = Math.max(0, ...rows.map(r => r.pts.length));
  $('histCard').hidden = !rows.length;
  if (!rows.length) return;
  $('histSub').textContent = `${prefs.pType === 'diesel' ? 'Diesel' : 'Benzin'} · ${days} ${days === 1 ? 'Tag' : 'Tage'}`;
  $('histList').innerHTML = (days < 3 ? `<p class="note" style="margin:0 0 6px">📈 Der Verlauf wird seit Kurzem jeden Morgen gesammelt – nach ein paar Tagen siehst du hier, wie sich die Preise entwickeln.</p>` : '') +
    rows.map(({ st, pts }) => {
      const now = pts[pts.length - 1][1], ref = pts[Math.max(0, pts.length - 8)][1], d = (now - ref) * 100;
      const v = pts.map(p => p[1]);
      const trend = pts.length < 2 ? '' : Math.abs(d) < 0.5 ? '<small class="same">≈ gleich</small>' : `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${num(Math.abs(d), 1)} ct</small>`;
      return `<div class="hrow"><div class="n">${esc(st.n)}</div>${spark(pts)}<div class="p">${num(now, 3)}${trend}</div>
        <div class="a">${pts.length > 1 ? `30 T.: ${num(Math.min(...v), 3)} – ${num(Math.max(...v), 3)} € · ` : ''}${esc(st.a)}</div></div>`;
    }).join('');
}
function histPopup(id) {
  const st = hist && hist.stations && hist.stations[id];
  const pts = st ? (st.p[hfuel()] || []).slice(-30) : [];
  if (pts.length < 2) return '';
  const v = pts.map(p => p[1]);
  return `📈 ${pts.length} Tage: ${num(Math.min(...v), 3)} – ${num(Math.max(...v), 3)} €<br>`;
}
renderHistory(); loadHistory();
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadHistory(); });

/* ---------- Termin-Erinnerungen per Telegram ---------- */
let tgTimer = null;
function renderTg(msg) {
  $('tgOn').checked = !!(prefs.tg && prefs.tg.on);
  $('tgCode').value = (prefs.tg && prefs.tg.code) || '';
  $('tgState').textContent = msg || (prefs.tg && prefs.tg.at ? `Zuletzt gesendet: ${new Date(prefs.tg.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${prefs.tg.err ? ' · ⚠️ ' + prefs.tg.err : ''}` : '');
  try { renderMore(); } catch {}
}
function scheduleReminders() { if (!prefs.tg || !prefs.tg.on) return; clearTimeout(tgTimer); tgTimer = setTimeout(() => pushReminders(false), 2000); }
async function pushReminders(manual) {
  const code = (prefs.tg && prefs.tg.code) || '';
  if (!/^[0-9a-f]{16}$/.test(code)) { if (manual) toast('Bitte zuerst den Code aus /code eintragen'); return; }
  const items = terms.filter(t => t.due).map(t => ({ t: t.title, d: t.due, a: t.amount || null, c: cars.length > 1 ? (cars.find(c => c.id === t.car) || {}).name || '' : '' }));
  try {
    const r = await fetch(PROXY_DEFAULT + '/reminders', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Bot-Code': code }, body: JSON.stringify({ items }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Senden fehlgeschlagen');
    prefs.tg.at = Date.now(); prefs.tg.err = ''; savePrefs(); renderTg();
    if (manual) toast(`✓ ${j.count} Termin${j.count === 1 ? '' : 'e'} an Telegram gesendet`);
  } catch (e) {
    prefs.tg.err = /fetch|network|load/i.test(e.message) ? 'keine Verbindung' : e.message; savePrefs(); renderTg();
    if (manual) toast(prefs.tg.err, 3500);
  }
}
$('tgOn').onchange = () => { prefs.tg = { ...(prefs.tg || {}), on: $('tgOn').checked }; savePrefs(); if (prefs.tg.on) pushReminders(true); renderTg(); };
$('tgCode').onchange = () => {
  const c = $('tgCode').value.trim().toLowerCase();
  if (c && !/^[0-9a-f]{16}$/.test(c)) return toast('Der Code hat 16 Zeichen (0–9, a–f) – schreib deinem Bot /code');
  prefs.tg = { ...(prefs.tg || {}), code: c }; savePrefs();
};
$('tgSend').onclick = () => { $('tgCode').onchange(); if (!(prefs.tg && prefs.tg.on)) { prefs.tg = { ...(prefs.tg || {}), on: true }; savePrefs(); } pushReminders(true); renderTg(); };
renderTg();
window.tgReady = true;
if (prefs.tg && prefs.tg.on && Date.now() - (prefs.tg.at || 0) > 864e5) pushReminders(false);   // einmal täglich abgleichen

/* Speicher schützen: Browser bitten, die Daten nicht automatisch zu löschen */
async function protectStorage(ask) {
  const out = $('storageState');
  if (!navigator.storage || !navigator.storage.persisted) { out.textContent = ''; return; }
  let ok = await navigator.storage.persisted().catch(() => false);
  if (!ok && ask && navigator.storage.persist) ok = await navigator.storage.persist().catch(() => false);
  out.innerHTML = ok ? '🔒 Speicher ist geschützt – das Handy löscht deine Daten nicht von selbst.'
    : '⚠️ Der Browser hat den dauerhaften Speicher (noch) nicht freigegeben. Tipp: App auf den Home-Bildschirm legen und regelmäßig sichern.';
}
protectStorage(entries.length > 0);

/* ---------- Profile & Cloud-Sync (Ende-zu-Ende verschlüsselt) ---------- */
// Änderungen erkennen: jedes Element bekommt einen Zeitstempel, gelöschte einen „Grabstein“,
// damit beim Abgleich zweier Handys klar ist, welcher Stand neuer ist.
const TOMB = 'tankbuch-geloescht';
let tomb = read(TOMB, {}); if (!tomb || typeof tomb !== 'object') tomb = {};
const known = new Map();
const itemKey = x => JSON.stringify({ ...x, updated: undefined });
const groups = () => [['e', entries], ['c', cars], ['t', terms]];
function rememberAll() { known.clear(); for (const [p, list] of groups()) for (const x of list) known.set(p + ':' + x.id, itemKey(x)); }
function stamp() {
  const now = Date.now(), seen = new Set();
  for (const [p, list] of groups()) for (const x of list) {
    const k = p + ':' + x.id, j = itemKey(x); seen.add(k);
    if (known.get(k) !== j) { x.updated = now; known.set(k, j); delete tomb[k]; }
  }
  for (const k of [...known.keys()]) if (!seen.has(k)) { tomb[k] = now; known.delete(k); }
  const old = now - 365 * 864e5;
  for (const k in tomb) if (tomb[k] < old) delete tomb[k];
  write(TOMB, tomb);
}
rememberAll();
window.syncReady = true;

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder(), dec = new TextDecoder();
// Aus Profilname + Passwort: Schlüssel zum Verschlüsseln und ein getrennter Anmelde-Schlüssel (PBKDF2, 310.000 Runden)
async function deriveProfile(name, pass) {
  const n = name.trim().toLowerCase();
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('tankbuch|' + n), iterations: 310000 }, base, 512);
  const id = hex(await crypto.subtle.digest('SHA-256', enc.encode('tankbuch-id|' + n))).slice(0, 40);
  return { name: name.trim(), id, k: b64u(bits.slice(0, 32)), a: b64u(bits.slice(32, 64)), v: 0, at: 0 };
}
const aesKey = () => crypto.subtle.importKey('raw', unb64u(prefs.sync.k), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), enc.encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return b64u(out);
}
async function open_(data) {
  const raw = unb64u(data);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aesKey(), raw.slice(12));
  return JSON.parse(dec.decode(pt));
}
async function cloud(method, body, extra = {}) {
  const r = await fetch(`${proxyUrl()}/sync/${prefs.sync.id}`, { method, headers: { 'X-Auth': prefs.sync.a, 'Content-Type': 'application/json', ...extra }, body: body && JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, ...j };
}
// zwei Stände zusammenführen: pro Element gewinnt der neuere, Gelöschtes bleibt gelöscht
function mergeAll(remote) {
  const t = { ...remote.tomb };
  for (const k in tomb) t[k] = Math.max(t[k] || 0, tomb[k]);
  const pick = (p, local, rem, clean) => {
    const m = new Map();
    for (const x of [...cleanList(rem, clean), ...local]) { const k = p + ':' + x.id, cur = m.get(k); if (!cur || (x.updated || 0) > (cur.updated || 0)) m.set(k, x); }
    return [...m.values()].filter(x => !(t[p + ':' + x.id] >= (x.updated || 0)));
  };
  return { entries: pick('e', entries, remote.entries, cleanEntry), cars: pick('c', cars, remote.cars, cleanCar), terms: pick('t', terms, remote.terms, cleanTerm), tomb: t };
}
let syncBusy = false, syncAgain = false, syncTimer = null;
function scheduleSync() { if (!prefs.sync) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 2500); }
async function syncNow(manual) {
  if (!prefs.sync) return;
  if (syncBusy) { syncAgain = true; return; }
  syncBusy = true; renderSync('Synchronisiere …');
  try {
    for (let tries = 0; tries < 3; tries++) {
      const r = await cloud('GET');
      if (r.status === 401) throw new Error('Passwort falsch oder Profil gehört jemand anderem');
      if (r.status === 503) throw new Error(r.error);
      if (r.status !== 200 && r.status !== 404) throw new Error('Cloud nicht erreichbar');
      const remote = r.status === 200 ? await open_(r.data).catch(() => { throw new Error('Daten konnten nicht entschlüsselt werden (falsches Passwort?)'); }) : { entries: [], cars: [], terms: [], tomb: {} };
      const m = mergeAll(remote);
      const before = JSON.stringify([entries, cars, terms]);
      entries = m.entries; cars = m.cars.length ? m.cars : cars; terms = m.terms; tomb = m.tomb;
      if (!cars.some(c => c.id === prefs.car)) { prefs.car = cars[0].id; savePrefs(); }
      write(KEY, entries); write(CARS, cars); write(TERMS, terms); write(TOMB, tomb); rememberAll();
      if (JSON.stringify([entries, cars, terms]) !== before) render();
      const same = r.status === 200 && JSON.stringify([remote.entries, remote.cars, remote.terms, remote.tomb]) === JSON.stringify([entries, cars, terms, tomb]);
      if (same) { prefs.sync.v = r.v; break; }
      const p = await cloud('PUT', { base: r.status === 200 ? r.v : 0, data: await seal({ entries, cars, terms, tomb }) });
      if (p.status === 409) continue;               // anderes Handy war schneller → nochmal zusammenführen
      if (p.status !== 200) throw new Error(p.error || 'Speichern in der Cloud fehlgeschlagen');
      prefs.sync.v = p.v; break;
    }
    prefs.sync.at = Date.now(); prefs.sync.err = ''; savePrefs();
    if (manual) toast('Synchronisiert ✓');
  } catch (e) {
    prefs.sync.err = /fetch|network|load/i.test(e.message) ? 'Keine Verbindung – wird später nachgeholt' : e.message; savePrefs();
    if (manual) toast(prefs.sync.err, 3500);
  }
  syncBusy = false; renderSync();
  if (syncAgain) { syncAgain = false; scheduleSync(); }
}
function renderSync(busy) {
  const on = !!prefs.sync;
  $('syncOff').hidden = on; $('syncOn').hidden = !on;
  if (!on) return;
  const when = prefs.sync.at ? new Date(prefs.sync.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'noch nie';
  $('syncInfo').innerHTML = `Angemeldet als <b>${esc(prefs.sync.name)}</b> 🔒<br>${busy ? busy : 'Zuletzt synchronisiert: ' + when}${prefs.sync.err && !busy ? `<br>⚠️ ${esc(prefs.sync.err)}` : ''}`;
  try { renderMore(); } catch { /* beim Start noch nicht bereit */ }
}
$('syLogin').onclick = async () => {
  const name = $('syName').value.trim(), pass = $('syPass').value;
  if (!/^[\w.@+-]{3,40}$/.test(name)) return toast('Profilname: 3–40 Zeichen, nur Buchstaben, Zahlen und . _ - @');
  if (pass.length < 10) return toast('Das Passwort braucht mindestens 10 Zeichen');
  if (/^(.)\1+$|^(0123456789|1234567890|passwort|password)/i.test(pass)) return toast('Bitte ein weniger leicht zu erratendes Passwort wählen');
  $('syLogin').disabled = true; $('syLogin').textContent = 'Verschlüssele …';
  try {
    prefs.sync = await deriveProfile(name, pass);
    const r = await cloud('GET');
    if (r.status === 401) { prefs.sync = null; throw new Error('Dieser Profilname ist schon vergeben oder das Passwort ist falsch'); }
    if (r.status === 404 && !await ask(`Neues Profil „${name}“ anlegen und deine Daten verschlüsselt in die Cloud laden?`, { ok: 'Anlegen' })) { prefs.sync = null; return; }
    if (r.status !== 200 && r.status !== 404) { prefs.sync = null; throw new Error(r.error || 'Cloud nicht erreichbar'); }
    $('syPass').value = '';
    if (r.status === 404) {
      // neues Profil anlegen – falls der Worker einen Einladungscode verlangt, danach fragen
      const first = { entries, cars, terms, tomb };
      let p = await cloud('PUT', { base: 0, data: await seal(first) });
      if (p.status === 403 && p.invite) {
        const code = await ask('Einladungscode für neue Profile (bekommst du vom Betreiber des Tankbuch-Workers):', { input: '', ok: 'Weiter' });
        if (!code) { prefs.sync = null; return; }
        p = await cloud('PUT', { base: 0, data: await seal(first) }, { 'X-Invite': code });
      }
      if (p.status !== 200) { prefs.sync = null; throw new Error(p.error || 'Profil konnte nicht angelegt werden'); }
      prefs.sync.v = p.v; prefs.sync.at = Date.now();
    }
    await syncNow(false);
    if (!prefs.sync.at) throw new Error(prefs.sync.err || 'Cloud nicht erreichbar');
    toast(r.status === 404 ? 'Profil angelegt ✓' : 'Angemeldet – Daten zusammengeführt ✓', 3000);
  } catch (e) {
    if (prefs.sync && !prefs.sync.at) prefs.sync = null;   // nie erfolgreich verbunden → nicht als angemeldet zählen
    toast(/fetch|network|load/i.test(e.message) ? 'Keine Verbindung zur Cloud' : e.message, 3500);
  }
  finally { $('syLogin').disabled = false; $('syLogin').textContent = 'Anmelden / Profil anlegen'; savePrefs(); renderSync(); }
};
$('syNow').onclick = () => syncNow(true);
$('syOut').onclick = async () => {
  if (!await ask('Abmelden? Deine Daten bleiben auf diesem Handy, werden aber nicht mehr abgeglichen.', { ok: 'Abmelden' })) return;
  prefs.sync = null; savePrefs(); renderSync(); toast('Abgemeldet');
};
$('syDel').onclick = async () => {
  if (!await ask('Profil und alle Daten in der Cloud endgültig löschen? Auf diesem Handy bleibt alles erhalten.', { ok: 'In der Cloud löschen', danger: true })) return;
  const r = await cloud('DELETE').catch(() => ({ status: 0 }));
  if (r.status !== 200) return toast('Löschen nicht möglich – keine Verbindung?');
  prefs.sync = null; savePrefs(); renderSync(); toast('Cloud-Profil gelöscht');
};
renderSync();
if (prefs.sync) syncNow(false);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadPrices(); renderTerms(); if (prefs.sync && Date.now() - (prefs.sync.at || 0) > 60e3) syncNow(false); } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
  addEventListener('load', () => {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // neue Version wurde im Hintergrund geladen → sofort anzeigen, aber nie mitten in einer Eingabe
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had || document.body.classList.contains('sheet-open')) return;
      location.reload();
    });
  });
