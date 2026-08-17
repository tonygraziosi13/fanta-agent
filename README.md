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
| `npm run listone` | Rigenera `assets/data/listone.csv` dall'`.xlsx` ufficiale |
| `npm run dataset` | Rigenera `dataset/players.json` dalle fonti esterne (lento) |
| `npm run dataset:test` | Test della pipeline dataset (senza rete) |

## Il listone

La fonte ufficiale è `Quotazioni_Fantacalcio_Stagione_2026_27.xlsx` (6 fogli).
L'app consuma un CSV, come richiesto dalle User Stories: `scripts/xlsx_to_csv.py`
fa la conversione usando la sola stdlib Python.

- Foglio `Tutti` → 497 giocatori, `IsActive = 1`
- Foglio `Ceduti` → 8 giocatori, `IsActive = 0` (restano nel DB: cancellarli
  romperebbe le watchlist già costruite)
- I fogli per ruolo sono viste ridondanti di `Tutti` e vengono ignorati

Il CSV generato **è versionato di proposito**: senza, il primo avvio non ha dati.
A ogni aggiornamento del listone ufficiale, sostituisci l'`.xlsx` e lancia
`npm run listone`; l'upsert su `id` aggiorna le quotazioni preservando le selezioni.

## Il dataset arricchito (Epic 4)

Il CSV imbarcato resta, ma come **fallback**. La fonte primaria è un dataset generato
fuori dall'app, che aggrega quattro sorgenti pubbliche attorno all'anagrafica del listone.

| Fonte | Cosa dà | Come |
|---|---|---|
| Fantacalcio.it | media voto, fantamedia, presenze, gol, assist | scraping della pagina statistiche; **l'id è lo stesso del listone**, quindi join esatta |
| Understat | xG, npxG, xA, xGChain, xGBuildup, tiri, passaggi chiave, minuti | endpoint JSON della lega, una richiesta sola |
| Transfermarkt | storico infortuni → indice di rischio | ricerca + pagina infortuni, ~2 richieste per giocatore |
| SofaScore | heatmap posizionali | API bloccata (403): il provider c'è, dichiara il fallimento e la pipeline prosegue |

```bash
npm run dataset                                  # tutto
npm run dataset -- --only understat --limit 30   # prova rapida
```

Produce `dataset/players.json` e `dataset/manifest.json`. Il manifest pesa poche centinaia
di byte e contiene l'hash del contenuto: l'app scarica **prima quello**, e nel caso normale
la sincronizzazione finisce lì. Il commit dei due file su GitHub *è* il rilascio — l'app
legge da `raw.githubusercontent`, URL configurato in `app.json` (`expo.extra.datasetUrl`).

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
