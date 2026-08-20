# Fanta Agent — Sprint 1

App mobile agentica per il fantacalcio. Sprint 1 consegna il fondamento dati e la
consultazione del listone: import offline, ricerca/filtri a latenza zero, watchlist
persistente con categorie personalizzabili.

## Requisiti

- **Node.js LTS 20+** (non presente sulla macchina di sviluppo attuale — va installato)
- **Python 3** (solo per rigenerare l'asset del listone)
- App **Expo Go** sul telefono, oppure un emulatore Android/iOS

## Avvio

```bash
npm install
npx expo start
```

Poi inquadra il QR code con Expo Go. Se `npm install` segnala versioni incompatibili
fra i pacchetti Expo:

```bash
npx expo install --fix
```

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm start` | Avvia il dev server Expo |
| `npm test` | Test su parsing, selettori e pipeline (logica pura, nessuna dipendenza nativa) |
| `npm run typecheck` | `tsc --noEmit` in modalità strict |
| `npm run listone` | Aggiorna `assets/data/listone.csv` dalle quotazioni ufficiali |
| `npm run listone:xlsx` | Riserva offline: rigenera il CSV da un `.xlsx` scaricato a mano |
| `npm run dataset` | Rigenera `dataset/players.json` dalle fonti esterne (lento) |
| `npm run dataset -- --full` | Come sopra, ignorando il delta di esecuzione |
| `npm run dataset:test` | Test della pipeline dataset (senza rete) |
| `python scripts/check_release.py <baseline>` | Decide se il dataset generato va pubblicato |

## Il listone

Il listone si aggiorna da solo dalle **quotazioni ufficiali** di Fantacalcio.it, per due
strade in cascata:

```bash
$env:FANTACALCIO_USER = "..."   # lo username, non l'email — facoltativo
$env:FANTACALCIO_PASS = "..."

npm run listone -- --dry-run    # dice cosa cambierebbe, non scrive
npm run listone                 # scarica e riscrive assets/data/listone.csv
npm run listone -- --no-login   # forza la seconda strada
```

1. **Download autenticato.** Il file `.xlsx` ufficiale è riservato agli utenti
   registrati: il login avviene con un browser headless (Playwright), che è l'unico modo
   perché il form passa da JavaScript. Dà il tracciato record completo e i fogli
   `Tutti` / `Ceduti`.
2. **Scraping della pagina pubblica.** Non richiede login e scatta da sola quando la
   prima non è percorribile — credenziali assenti, browser non installato, sito che
   rifiuta l'IP. È il percorso che ha retto finora, e non un ramo d'emergenza.

Entrambe espongono lo **stesso `Id`** del CSV: la corrispondenza con le statistiche di
Fantacalcio.it è esatta, senza alcun matching per nome. I ceduti si riconoscono dal
foglio `Ceduti` o dal marcatore `out-of-game`, a seconda della strada: l'elenco ufficiale
non toglie nessuno, quindi senza quel flag un venduto resterebbe acquistabile. Chi esce
**non viene cancellato**: resta con `IsActive = 0`, o si spezzerebbero le watchlist che
lo contengono.

`scripts/xlsx_to_csv.py` (`npm run listone:xlsx`) resta per convertire a mano un `.xlsx`
già scaricato, senza rete.

Il CSV generato **è versionato di proposito**: senza, il primo avvio non ha dati.
L'upsert su `id` aggiorna le quotazioni preservando le selezioni dell'utente. Il
workflow settimanale lancia il refresh **prima** della pipeline e committa CSV e dataset
insieme: viaggiano nello stesso commit perché condividono gli `Id`, e separarli
lascerebbe chi apre l'app senza rete con un listone diverso da chi sincronizza.

## Il dataset arricchito (Epic 4)

Il CSV imbarcato resta, ma come **fallback**. La fonte primaria è un dataset generato
fuori dall'app, che aggrega quattro sorgenti pubbliche attorno all'anagrafica del listone
in una **cascata a tre livelli**: ogni fonte gira solo su chi le precedenti non hanno
coperto, così quelle costose vedono decine di giocatori invece di centinaia.

| # | Fonte | Cosa dà | Come |
|---|---|---|---|
| 0 | Fantacalcio.it | media voto, fantamedia, presenze, gol, assist | una pagina; **l'id è lo stesso del listone**, quindi join esatta |
| 1 | Understat | xG, npxG, xA, xGChain, xGBuildup, tiri, passaggi chiave, minuti | le **top 5 leghe** europee, cinque richieste in tutto |
| 2 | FBref | xG, npxG, xA, tiri, passaggi chiave | per chi gioca fuori dalle top 5 (Serie B, resto del mondo); ~2 richieste a giocatore, con interruttore automatico se Cloudflare respinge |
| 3 | Transfermarkt | storico infortuni → indice di rischio, e rendimento grezzo | infortuni per tutti, rendimento solo per chi è ancora scoperto |

Le metriche sono **grezze**: nessun moltiplicatore di lega, un xG in Ligue 1 pesa come
uno in Serie A. `xGChain` e `xGBuildup` esistono solo al livello 1 — FBref non li
pubblica, e restano `null` invece di diventare zero.

```bash
npm run dataset                                  # tutto (delta: solo chi serve)
npm run dataset -- --full                        # ignora il delta
npm run dataset -- --only understat --limit 30   # prova rapida, scrive in dataset/preview/
```

Produce `dataset/players.json` e `dataset/manifest.json`. Il manifest pesa poche centinaia
di byte e contiene l'hash del contenuto: l'app scarica **prima quello**, e nel caso normale
la sincronizzazione finisce lì. Il commit dei due file su GitHub *è* il rilascio — sono
serviti da GitHub Pages dalla radice di `main`, URL configurato in `app.json`
(`expo.extra.datasetUrl`). Il `.nojekyll` in radice serve a Pages e non va rimosso.

### Il rilascio è automatico

`.github/workflows/dataset.yml` rigenera e pubblica ogni lunedì, o a richiesta dalla tab
Actions (`limit` e `only` servono per una prova rapida). Prima di committare, un gate
decide:

- **pubblica** se la versione è nuova e nessuna fonte è in regressione;
- **non pubblica** se l'hash è identico a quello online — a fonti immutate cambierebbe
  solo il timestamp;
- **blocca il rilascio** se una fonte è caduta o è crollata sotto il 70% della copertura
  precedente. Il job diventa rosso *apposta*: il dataset già pubblicato è migliore di
  quello appena generato, e resta dov'è.

Lo stesso gate è eseguibile in locale contro una copia del dataset online:

```bash
cp -r dataset /tmp/baseline && npm run dataset
python scripts/check_release.py /tmp/baseline
```

**Il listone comanda.** Le metriche si agganciano ai giocatori del listone e mai il
contrario: chi è nuovo in Serie A resta nel dataset con metriche `null` e un flag di
copertura a `false`. Nell'app diventa "dato non disponibile", non uno zero.

Il pezzo difficile è agganciare i nomi: il listone scrive `Martinez Jo.`, Understat
`Lautaro Martínez`. La risoluzione usa strategie in cascata con il ruolo come vincolo
rigido (un portiere non è mai un attaccante) e la squadra come sola conferma (fra le due
stagioni i giocatori si trasferiscono). Quel che resta ambiguo non viene indovinato: finisce
nel report, e si risolve a mano in `scripts/dataset/manual_map.json`.

## Architettura

```
app/                    expo-router — boot gate, bottom tabs, schermate
src/
  core/
    db/                 client SQLite, schema, migrazioni
    repositories/       accesso ai dati — unico strato che parla con SQLite
    parsing/            csvParser (puro, testabile) + listoneAsset (nativo)
    middleware/         pipeline + hook: boot, assegnazioni, filtri, categorie
  domain/               tipi ed entità, mappatura colori dei ruoli
  state/                store Zustand + selettori puri
  agent/                registro tool per l'agente (scaffolding, senza LLM)
  ui/                   componenti e design token
```

### La pipeline

Il punto architetturale centrale è `src/core/middleware/pipeline.ts`. Ogni azione
attraversa una sequenza fissa:

```
validate  ->  reduce  ->  effect
(sync)        (sync)      (async, non atteso)
```

`reduce` aggiorna solo lo stato in memoria ed è sincrono: la UI risponde nello
stesso frame del tocco. `effect` scrive su SQLite in background: **il framerate non
dipende mai dalla latenza del disco.**

È anche il punto di innesto dell'agente. Il tool `assign_player_to_category` non
parla con i repository — passa dalla stessa pipeline del bottone della UI, quindi
un'azione dell'agente e un tap dell'utente sono la stessa operazione per costruzione.

### Perché ogni riga si sottoscrive da sola

`PlayerRow` non riceve lo stato di assegnazione come prop: lo legge da sé con
`useAssignedCategoryId(player.id)`. Se lo ricevesse dall'alto, assegnare un
giocatore ri-renderizzerebbe tutte le 497 righe. Così ne cambia una.

Verificabile con React DevTools → "Highlight updates": assegnando un giocatore
deve illuminarsi **una sola riga**.

## Scelte fuori dal testo delle User Stories

- **Categorie editabili dall'utente.** Le US le davano hardcoded e in due varianti
  contraddittorie (US3 vs US8-T1). Sono invece entità persistite, con CRUD, riordino
  e schermata di gestione.
- **`watchlist.category_id` FK** al posto di `category_name` testuale: rinominare
  una categoria non orfana le assegnazioni.
- **`watchlist.player_id UNIQUE`**: un giocatore in una categoria sola. Rende lo
  spostamento un UPDATE atomico ed elimina lo stato incoerente alla radice.
- **Bottom sheet su `Animated` di RN** invece di `@gorhom/bottom-sheet`, che
  richiederebbe reanimated + worklets. Stesso risultato sul thread UI, tre
  dipendenze native in meno.

## Copertura delle User Stories

| US | Stato | Dove |
|---|---|---|
| US7 — Init e persistenza listone | ✅ | `core/middleware/hooks/bootHook.ts`, `parsing/`, `playersRepository` |
| US1 — Navigazione listone | ✅ | `app/(tabs)/listone.tsx`, `ui/components/PlayerRow.tsx` |
| US2 — Ricerca e filtri | ✅ | `useFiltersStore`, `selectors.ts`, `filterHook.ts` |
| US8 — Persistenza stato | ✅ | `watchlistRepository`, `useWatchlistStore`, `assignmentHook` |
| US3 — Smistamento categorie | ✅ | `ui/components/CategorySheet.tsx` |
| US4 — Feedback visivo | ✅ | `PlayerRow` (memo + sottoscrizione per riga) |
| US5 — Consultazione watchlist | ✅ | `app/(tabs)/watchlist.tsx` |
| US6 — Manutenzione scelte | ✅ | `CategorySheet` + `assignmentHook` |

## Fuori scope Sprint 1

Runtime LLM dell'agente, gestione budget e asta live, statistiche avanzate, sync
remoto del listone, autenticazione. `src/agent/` è scaffolding tipizzato ed
eseguibile (`executeTool`), ma nessun modello lo invoca ancora.
