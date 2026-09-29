# Matematikplatform

En dansk, browserbaseret øvelsesplatform til matematikundervisning. Elever
tilslutter sig en lærers session med en kode og et alias, vælger en øvelsesbane
og løser løbende genererede opgaver. Læreren kan følge elevernes arbejde i
realtid.

## Funktioner

- Øvelser i grundregning, potenser af 10, brøker, regnehierarki, omskrivning,
  procent/promille og ligninger.
- Indstillinger for bl.a. regneart, cifre, decimaler og sværhedsgrad.
- Svarvalidering, facit, streaks og niveauer.
- Whiteboard til mellemregninger med synkronisering til lærersiden.
- Lærerside på `/teacher`, der kan oprette 90-minutters sessioner, se elevernes
  aktivitet og fjerne elever eller lukke sessioner.
- Synkronisering af elevaktivitet, svar, opgaver og whiteboard via Supabase
  Realtime.

## Lokal opstart

### Forudsætninger

- Node.js 20 eller nyere og npm.
- Et Supabase-projekt.
- Tabellerne `sessions` og `participants` i Supabase. Databaseskemaet er ikke
  med i dette repository; det eksisterende Supabase-projekt skal derfor have
  det på plads.

Koden forventer mindst disse felter:

| Tabel | Påkrævede felter |
| --- | --- |
| `sessions` | `id`, `code`, `created_at`, `expires_at` |
| `participants` | `session_id`, `alias`, `last_seen`, `client_token` |

`sessions.code` skal kunne være unik. `participants` skal have en unik nøgle på
`(session_id, alias)`, da elever oprettes med en upsert.

Opret en lokal fil ved navn `.env.local` i projektroden:

```env
NEXT_PUBLIC_SUPABASE_URL=https://dit-projekt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=din-anon-key
```

Brug **Project URL** og den offentlige **anon key** fra Supabase-projektets API-
indstillinger. Filen må ikke commit'es.

Installer afhængigheder og start udviklingsserveren:

```bash
npm install
npm run dev
```

Åbn derefter [http://localhost:3000](http://localhost:3000). Gå til
[http://localhost:3000/teacher](http://localhost:3000/teacher) for at oprette
en session. Åbn elevsiden i et andet browservindue, indtast sessionkoden og et
alias, og vælg en øvelsesbane.

## Supabase-konfiguration

Appen udfører `select`, `insert`, `update`, `upsert` og `delete` direkte fra
browseren mod de to tabeller. Hvis Row Level Security er slået til, skal de
tilhørende policies tillade disse handlinger for den anvendte anon key.

Aktivér også Supabase Realtime/Broadcast for projektet. Lærersiden lytter
desuden efter sletninger i `participants` via Postgres Changes, så den tabel
skal være tilføjet til Realtime-publiceringen, hvis denne funktion skal virke.

`sql/cleanup_expired_sessions.sql` kan køres i Supabase SQL Editor for at
automatisk slette udløbne sessioner hvert femte minut. Det kræver, at
`pg_cron` er tilgængelig i projektet.

## Kommandoer

```bash
npm run dev    # Start udviklingsserver
npm run build  # Byg til produktion
npm run start  # Kør produktionsbygget app
npm run lint   # Kør ESLint
```

## Teknologi

- Next.js 16 og React 19
- TypeScript
- Tailwind CSS
- Supabase (database og Realtime)
