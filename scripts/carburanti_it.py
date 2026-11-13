#!/usr/bin/env python3
"""Spritpreise Italien (inkl. Südtirol) für das Tankbuch aufbereiten.

Quelle: offene Daten des italienischen Ministeriums (MIMIT, „Osservaprezzi carburanti“),
täglich mit dem Stand von 8 Uhr. Das Skript lädt die Tankstellenliste und die Preise,
behält pro Tankstelle den günstigsten Preis für Benzin und Diesel (Self und bedient)
und schreibt kleine Kacheln zu je 1° × 1°, damit die App nur ihre Umgebung laden muss.

Aufruf: python3 scripts/carburanti_it.py <Ausgabeordner> [anagrafica.csv prezzi.csv]
Ohne die beiden Dateien werden sie direkt beim MIMIT geladen.
"""
import csv
import io
import json
import math
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

URL_STATIONS = "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv"
URL_PRICES = "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv"
MAX_AGE_DAYS = 14  # ältere Preismeldungen gelten als veraltet
FUELS = {"benzina": "b", "gasolio": "d"}  # nur die normalen Sorten, keine Premium-Produkte


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tankbuch-data/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def decode(raw):
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", errors="replace")


def rows(text):
    """Zeilen als Listen; Trennzeichen (; oder |) wird aus der Kopfzeile erkannt.
    Die erste Zeile („Estrazione del …“) und die Kopfzeile werden übersprungen."""
    lines = [l for l in text.splitlines() if l.strip()]
    head_i = next(i for i, l in enumerate(lines[:5]) if l.lower().startswith("idimpianto"))
    sep = "|" if lines[head_i].count("|") > lines[head_i].count(";") else ";"
    reader = csv.reader(io.StringIO("\n".join(lines[head_i + 1:])), delimiter=sep, quotechar='"')
    return [[c.strip() for c in r] for r in reader if r]


def num(s):
    try:
        return float(s.replace(",", "."))
    except (ValueError, AttributeError):
        return None


def parse_date(s):
    for fmt in ("%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            pass
    return None


def title(s):
    return " ".join(w.capitalize() if w.isupper() or w.islower() else w for w in s.split())


def build(stations_csv, prices_csv, out_dir):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    stations = {}
    for r in rows(stations_csv):
        # idImpianto;Gestore;Bandiera;Tipo Impianto;Nome Impianto;Indirizzo;Comune;Provincia;Latitudine;Longitudine
        # Adressen enthalten manchmal das Trennzeichen – darum Ort/Koordinaten von hinten lesen.
        if len(r) < 10:
            continue
        lat, lng = num(r[-2]), num(r[-1])
        if lat is None or lng is None or not (35 < lat < 48) or not (6 < lng < 19):
            continue
        brand = r[2] if r[2] and r[2].lower() not in ("pompe bianche", "") else ""
        stations[r[0]] = {
            "n": title(r[4] or r[1])[:60],
            "br": title(brand)[:30],
            "a": title(" ".join(r[5:-4]))[:80],
            "c": title(r[-4])[:40],
            "lat": round(lat, 5), "lng": round(lng, 5),
        }

    best = {}  # (id, sorte) -> {"s": self, "v": bedient, "t": datum}
    for r in rows(prices_csv):
        # idImpianto;descCarburante;prezzo;isSelf;dtComu
        if len(r) < 5 or r[0] not in stations:
            continue
        key = FUELS.get(r[1].strip().lower())
        price, when = num(r[2]), parse_date(r[4])
        if not key or not price or not (0.5 < price < 4) or not when or now - when > timedelta(days=MAX_AGE_DAYS):
            continue
        slot = best.setdefault((r[0], key), {"s": None, "v": None, "t": when})
        field = "s" if r[3].strip() == "1" else "v"
        if slot[field] is None or price < slot[field]:
            slot[field] = price
        slot["t"] = max(slot["t"], when)

    tiles = {}
    for (sid, key), p in best.items():
        st = stations[sid]
        st.setdefault("p", {})[key] = [p["s"], p["v"], p["t"].strftime("%Y-%m-%dT%H:%M")]
    count = 0
    for sid, st in stations.items():
        if "p" not in st:
            continue
        tiles.setdefault(f"{math.floor(st['lat'])}_{math.floor(st['lng'])}", []).append({"id": sid, **st})
        count += 1

    os.makedirs(os.path.join(out_dir, "it"), exist_ok=True)
    for name, items in tiles.items():
        with open(os.path.join(out_dir, "it", name + ".json"), "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
    meta = {"updated": now.strftime("%Y-%m-%dT%H:%MZ"), "stations": count, "tiles": sorted(tiles),
            "source": "MIMIT – Osservaprezzi carburanti (IODL 2.0)"}
    with open(os.path.join(out_dir, "it", "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    print(f"{len(stations)} Tankstellen, {count} mit aktuellen Preisen, {len(tiles)} Kacheln")
    if count < 1000:
        sys.exit("Zu wenige Tankstellen mit Preisen – Daten sehen fehlerhaft aus, nichts veröffentlichen.")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "carburanti-out"
    if len(sys.argv) >= 4:
        s_csv, p_csv = (decode(open(p, "rb").read()) for p in sys.argv[2:4])
    else:
        s_csv, p_csv = decode(fetch(URL_STATIONS)), decode(fetch(URL_PRICES))
    build(s_csv, p_csv, out)
