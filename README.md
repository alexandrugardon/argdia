# ARGDIA – jurnal glicemie (PWA)

Aplicație web care funcționează pe PC, telefon și tabletă. Datele se salvează pe dispozitiv (funcționează offline) și se sincronizează într-un Google Sheet numit „ARGDIA - Date”, în Google Drive-ul tău.

## 1. Publicare pe GitHub Pages
1. Creează cont: https://github.com/signup
2. New repository → nume `argdia` → Public → Create.
3. „uploading an existing file” → trage toate fișierele din acest folder (index.html, app.js, style.css, sw.js, manifest.webmanifest, icon-192.png, icon-512.png) → Commit.
4. Settings → Pages → Source: „Deploy from a branch”, Branch: `main` / `/ (root)` → Save.
5. După 1–2 minute aplicația este la `https://NUMELE-TAU.github.io/argdia/`.

Repository-ul public conține doar codul aplicației, nu datele tale (acestea sunt doar în Google Drive și pe dispozitivele tale).

## 2. Autentificare Google (o singură dată, gratuit)
1. https://console.cloud.google.com → proiect nou „ARGDIA”.
2. APIs & Services → Library → activează **Google Sheets API** și **Google Drive API**.
3. OAuth consent screen: User type „External”, nume app „ARGDIA”, email-ul tău; la „Test users” adaugă adresa ta Google. Scope: `.../auth/drive.file`.
4. Credentials → Create credentials → OAuth client ID → „Web application”.
   Authorized JavaScript origins: `https://NUMELE-TAU.github.io`
5. Copiază Client ID-ul și lipește-l în aplicație: Setări → Google Client ID → Conectează.

## 3. Instalare pe Android
Deschide adresa în Chrome → meniul ⋮ → „Instalează aplicația”.

## Memento-uri
Setări → alege orele → „Descarcă memento-uri (.ics)”. Deschide fișierul pe telefon → se adaugă în Google Calendar, cu alarmă zilnică.
