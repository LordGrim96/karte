# Cloudflare-Zwischendienst für die Italien-Spritpreise

Der Server des italienischen Ministeriums antwortet nicht auf GitHub. Ein kleiner,
kostenloser Cloudflare Worker holt die Preise stattdessen über einen europäischen Server.

## Einrichten (ca. 10 Minuten, einmalig)

1. Auf **https://dash.cloudflare.com/sign-up** ein kostenloses Konto anlegen (E-Mail + Passwort, E-Mail bestätigen).
2. Links im Menü **„Workers & Pages“** öffnen (ggf. unter „Compute“).
3. **„Create“** → **„Create Worker“** (bzw. „Start with Hello World!“).
4. Als Namen **`tankbuch-proxy`** eintragen → **„Deploy“**.
5. Auf **„Edit code“** tippen, den gesamten Beispielcode löschen und den Inhalt von
   [`tankbuch-proxy.js`](tankbuch-proxy.js) einfügen → **„Deploy“**.
6. Die Adresse des Workers kopieren, sie sieht so aus:
   `https://tankbuch-proxy.DEIN-NAME.workers.dev`
7. Die Adresse im Browser öffnen – es sollte **„Tankbuch-Zwischendienst läuft ✓“** erscheinen.
8. Die Adresse an Claude schicken bzw. im Tankbuch unter **Mehr → Spritpreise → Italien-Zwischendienst** eintragen.

## Kosten & Datenschutz

- Der kostenlose Tarif erlaubt 100.000 Aufrufe pro Tag – das Tankbuch braucht pro Handy etwa 2 am Tag.
- Der Worker speichert nichts. Er reicht nur die zwei öffentlichen Dateien des Ministeriums weiter.
- Andere Webseiten können ihn nicht aus dem Browser heraus benutzen (nur das Tankbuch ist freigegeben).

---

# Teil 2: Preis-Alarm per Telegram (optional)

Der Worker schaut jeden Morgen in die Preise und schickt dir eine Telegram-Nachricht, wenn in
deiner Nähe eine Tankstelle unter deinem Wunschpreis liegt. Funktioniert für Italien.

## A) Telegram-Bot anlegen (5 Minuten)

1. Telegram öffnen und nach **@BotFather** suchen (blauer Haken!) → **Starten**.
2. `/newbot` schicken.
3. Einen Namen eingeben, z. B. `Mein Tankbuch`.
4. Einen Benutzernamen eingeben, der auf `bot` endet, z. B. `tankbuch_edengrim_bot`.
5. BotFather schickt dir einen **Token** (sieht so aus: `1234567890:AAH...`). **Geheim halten!**
6. Deinen neuen Bot öffnen (Link in der Nachricht) → **Starten** drücken und „hallo“ schicken.
7. Im Browser öffnen (TOKEN durch deinen Token ersetzen):
   `https://api.telegram.org/botTOKEN/getUpdates`
   Dort steht `"chat":{"id":123456789` – diese Zahl ist deine **Chat-ID**.

## B) Worker in Cloudflare erweitern

1. **dash.cloudflare.com** → **Workers und Pages** → **tankbuch-proxy**.
2. **Code bearbeiten** → alles löschen → den neuen Inhalt von [`tankbuch-proxy.js`](tankbuch-proxy.js) einfügen → **Bereitstellen**.
3. Zurück zum Worker → **Einstellungen** → **Variablen und geheime Schlüssel** → **Hinzufügen**:

   | Name | Typ | Wert (Beispiel) |
   |---|---|---|
   | `TELEGRAM_TOKEN` | **Geheim** (Secret) | dein Token von BotFather |
   | `TELEGRAM_CHAT_ID` | Text | `123456789` |
   | `ALARM_LAT` | Text | `46.498` (aus der App: Mehr → Preis-Alarm → Koordinaten) |
   | `ALARM_LNG` | Text | `11.354` |
   | `ALARM_RADIUS` | Text | `10` (km) |
   | `ALARM_FUEL` | Text | `benzina` oder `gasolio` |
   | `ALARM_MAX_PRICE` | Text | `1.80` – leer lassen = jeden Tag die 5 günstigsten |

   → **Bereitstellen**.
4. **Einstellungen** → **Trigger** (Triggers) → **Cron-Trigger hinzufügen** → `45 8 * * *`
   (jeden Tag 9:45 Uhr Winterzeit / 10:45 Uhr Sommerzeit) → **Hinzufügen**.

## C) Testen

Im Browser öffnen (CHATID durch deine Chat-ID ersetzen):
`https://tankbuch-proxy.edengrim67.workers.dev/alarm-test?chat=CHATID`

Es erscheint „Nachricht gesendet ✓“ und in Telegram kommt eine Test-Nachricht.

## D) Bot-Befehle einschalten (Preise jederzeit abfragen)

Einmal im Browser öffnen (CHATID durch deine Chat-ID ersetzen):
`https://tankbuch-proxy.edengrim67.workers.dev/telegram-setup?chat=CHATID`

Danach kannst du dem Bot jederzeit schreiben:

| Du schickst | Antwort |
|---|---|
| **⛽ Preise** oder `/preise` | die 5 günstigsten Tankstellen bei dir zuhause (Sorte aus `ALARM_FUEL`) |
| **Diesel** / **Benzin** | dieselbe Liste für die gewählte Sorte |
| **📍 Standort senden** | Preise genau dort, wo du gerade bist |

Der Bot antwortet nur dir (deiner Chat-ID). Telegram schickt die Nachrichten mit einem geheimen
Kennwort an den Worker, das aus deinem Bot-Token abgeleitet ist – andere können den Bot nicht benutzen.

## F) Termin-Erinnerungen, Preisverlauf, Profil-Meldung

Brauchen den KV-Speicher aus Teil 3 (`TANKBUCH_KV`) und den aktuellen Worker-Code.

- **Termin-Erinnerungen:** Schreib deinem Bot `/code`. Trag den Code in der App unter
  **Mehr → Preis-Alarm → Termin-Erinnerungen** ein und schalte „Termine an Telegram senden“ ein.
  Der Bot erinnert 14, 7, 3 und 1 Tag vorher und am Tag selbst (zur Uhrzeit deines Cron-Triggers).
  `/termine` zeigt jederzeit alle anstehenden Termine. Die App schickt nur Bezeichnung, Datum und Betrag.
- **Preisverlauf:** Läuft automatisch mit dem Cron-Trigger – jeden Morgen werden die Preise der
  ~40 Tankstellen rund um `ALARM_LAT`/`ALARM_LNG` gespeichert (bis 120 Tage). Die App zeigt den
  Verlauf auf der Übersicht und in der Karte.
- **Neues Cloud-Profil:** Der Bot meldet dir, wenn jemand ein neues Profil anlegt.

Nach dem Einfügen des neuen Codes einmal `/telegram-setup?chat=DEINE_CHAT_ID` öffnen, damit
die neuen Befehle (`/termine`, `/code`) im Bot-Menü erscheinen.

---

# Teil 3: Profile & Cloud-Sync

Damit das Tankbuch Profile in der Cloud speichern kann, braucht der Worker einen kleinen
Datenspeicher („KV“). Die Daten kommen schon **verschlüsselt** vom Handy – der Worker und
Cloudflare können sie nicht lesen.

## A) Speicher anlegen

1. **dash.cloudflare.com** → links **„Speicher und Datenbanken“** (Storage & Databases) → **„KV“**
   (manchmal direkt unter „Workers und Pages“ → „KV“).
2. **„Erstellen“** bzw. **„Namespace erstellen“** (Create namespace) → Name: **`tankbuch`** → **„Hinzufügen“**.

## B) Speicher mit dem Worker verbinden

1. **Workers und Pages** → **tankbuch-proxy** → **„Einstellungen“** (Settings) → **„Bindungen“** (Bindings).
2. **„Hinzufügen“** (Add) → **„KV-Namespace“**.
3. Variablenname: **`TANKBUCH_KV`** (genau so, Großbuchstaben) – KV-Namespace: **`tankbuch`** → **„Speichern“/„Bereitstellen“**.

## C) Neuen Code einfügen

1. **„Code bearbeiten“** → alles löschen → den aktuellen Inhalt von [`tankbuch-proxy.js`](tankbuch-proxy.js) einfügen → **„Bereitstellen“**.

## D) In der App

**Mehr → ☁️ Profil & Cloud-Sync** → Profilname und Passwort eingeben → **„Anmelden / Profil anlegen“**.
Auf einem zweiten Handy denselben Profilnamen und dasselbe Passwort eingeben – fertig.

## Kosten & Sicherheit

- Kostenlos: 1.000 Speichervorgänge und 100.000 Abrufe pro Tag.
- Verschlüsselung: AES-256 auf dem Handy, Schlüssel aus dem Passwort (PBKDF2, 310.000 Runden).
  Der Worker speichert nur den verschlüsselten Block und einen Prüfwert für die Anmeldung.
- **Passwort vergessen = Cloud-Daten weg.** Die Daten auf dem Handy bleiben erhalten.

## E) Einladungscode (empfohlen)

Damit niemand Fremdes in deinem Cloudflare-Speicher Profile anlegen kann:
**Worker → Einstellungen → Variablen und geheime Schlüssel → Hinzufügen**
`SYNC_INVITE` – Typ **Geheim** – Wert: ein Code deiner Wahl, z. B. `Familie-Tank-2026`.

Wer ein **neues** Profil anlegt, wird in der App einmal nach diesem Code gefragt.
Bestehende Profile und das Anmelden auf weiteren Handys brauchen ihn nicht.

---

# Teil 4: Sicherheits-Checkliste für deine Konten

Die App und der Worker sind abgesichert – am wichtigsten ist jetzt, dass niemand an deine Konten kommt:

- [ ] **GitHub:** Zwei-Faktor-Anmeldung einschalten (Settings → Password and authentication → Two-factor authentication).
- [ ] **Cloudflare:** Zwei-Faktor-Anmeldung einschalten (Profil → Authentifizierung → Zwei-Faktor-Authentifizierung).
- [ ] **Telegram:** Zweistufige Bestätigung einschalten (Einstellungen → Datenschutz und Sicherheit).
- [ ] **Geheimnisse nie weitergeben:** Bot-Token, Tankerkönig-Schlüssel, Cloud-Passwort, Einladungscode.
- [ ] **Bot-Token verraten?** → bei @BotFather `/revoke`, neuen Token in Cloudflare eintragen, `/telegram-setup?chat=…` erneut öffnen.
- [ ] **Sicherung:** ab und zu unter „Mehr → Sicherung speichern“ eine Datei in iCloud/Google Drive ablegen.
