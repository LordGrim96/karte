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
