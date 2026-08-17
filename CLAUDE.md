# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cos'è

App mobile React Native (Expo) per il fantacalcio: configurazioni d'asta, consultazione
offline del listone Serie A, watchlist con categorie personalizzabili e metriche avanzate
per calciatore, scaricate da un dataset remoto versionato. Predisposta per una parte
agentica LLM che non è ancora implementata.

Il codice cita le User Story dello Sprint 1 (es. "US4-T2") nei commenti, ma **il
documento delle US non è nel repository**: non cercarlo e non ricostruirlo. Le US
sopravvivono in due posti soltanto — i commenti di intestazione dei moduli
(`pipeline.ts`, `assignmentHook.ts`, `app/_layout.tsx`…), che spiegano il *perché* di
ogni vincolo, e la tabella di copertura in `README.md`. Quando tocchi codice marcato
`US…`, leggi prima il commento del modulo: diversi vincoli apparentemente arbitrari sono
criteri di accettazione. Le configurazioni d'asta sono invece fuori dalle US: nascono
dopo, e sono descritte più sotto.

Nemmeno la history git è una fonte di contesto: c'è un solo commit
("Inizializzazione Repository") che contiene il solo `.gitignore`.

## Comandi

```bash
npm install            # Node LTS 20+ richiesto
npx expo start         # dev server; scansiona il QR con Expo Go
npm test               # Jest — solo logica pura, nessuna dipendenza nativa
npm run typecheck      # tsc --noEmit, strict + noUncheckedIndexedAccess
npm run listone        # rigenera assets/data/listone.csv dall'.xlsx
npm run dataset        # rigenera dataset/players.json dalle fonti esterne (lento)
npm run dataset:test   # unittest della pipeline Python (istantanei, senza rete)

npm test -- selectors                    # un solo file di test
npm test -- -t "combina ricerca"         # un solo caso
npx expo install --fix                   # allinea le versioni dei pacchetti Expo

npm run dataset -- --only understat --limit 30   # prova rapida di una fonte
npm run dataset -- --no-cache                    # ignora la cache HTTP su disco
```

## Le tre invarianti che governano il codice

### 1. La pipeline: `validate → reduce → effect`

`src/core/middleware/pipeline.ts` è il modulo centrale. Ogni azione utente attraversa
stadi ordinati:

- `validate` — sincrono, può interrompere precocemente. Tutti i `validate` girano
  prima di qualunque `reduce`, così un fallimento tardivo non lascia stato a metà.
- `reduce` — sincrono, tocca **solo** lo stato in memoria (Zustand). Niente I/O.
- `effect` — asincrono, scrive su SQLite, **deliberatamente non atteso**.

Conseguenza: al ritorno di `dispatch()` la UI ha già i dati nuovi; il framerate non
dipende mai dalla latenza del disco. Un `effect` che fallisce non propaga alla UI e
non blocca gli stadi successivi.

Non aggirare la pipeline chiamando i repository dalla UI. Gli hook in
`src/core/middleware/hooks/` sono l'API applicativa: `assignPlayer`, `unassignPlayer`,
`setSearchQuery`, `toggleRoleFilter`.

Eccezione documentata: `categoryHook.ts` e `configurationHook.ts` non usano
`createPipeline` perché la creazione ha bisogno dell'id AUTOINCREMENT prima di poter
aggiornare lo stato locale. Sono asincroni e attesi dalla UI — accettabile perché fuori
dal percorso caldo dello scroll.

`assignmentHook` fissa `configId` **nell'azione al dispatch**, non lo rilegge in
`effect`: fra i due stadi passa del tempo e una scrittura non deve finire in una lega
diversa da quella che l'utente aveva davanti.

### 2. Ogni riga del listone si sottoscrive da sola

`PlayerRow` **non** riceve lo stato di assegnazione come prop: lo legge con
`useAssignedCategoryId(player.id)`. Passarlo dall'alto farebbe ri-renderizzare tutte le
497 righe a ogni assegnazione — è ciò che US4-T2 vieta esplicitamente.

Il `memo` ha un comparatore custom che ignora deliberatamente `onPressAssign`. Se
aggiungi props a `PlayerRow`, aggiorna `areEqual` o il componente smetterà di reagire.

Verifica: React DevTools → "Highlight updates". Assegnando un giocatore deve
illuminarsi una sola riga.

### 3. Filtri e ricerca non toccano mai il database

Il listone viene letto da SQLite una volta sola, al boot. `selectFilteredPlayers`
lavora sull'array in RAM. `filterHook` non ha alcuno stadio `effect`, ed è
intenzionale (US2-T4).

## Flusso dei dati

```
Quotazioni_*.xlsx  --[scripts/xlsx_to_csv.py]-->  assets/data/listone.csv
                                                          |
                                          [bootHook: parse + bulk upsert]
                                                          v
                                                    SQLite (players)
                                                          |
                                              [load() al boot, una volta]
                                                          v
                                              usePlayersStore (RAM)  <-- UI e agente
```

- Il CSV generato **è versionato di proposito**: senza, il primo avvio non ha dati.
- `metro.config.js` registra `.csv` in `assetExts`; rimuoverlo rompe il bundling
  dell'asset.
- `src/core/parsing/csvParser.ts` è puro (solo papaparse) per essere testabile senza
  ambiente nativo; le dipendenze Expo stanno isolate in `listoneAsset.ts`.
- I giocatori ceduti restano nel DB con `is_active = 0`. Non cancellarli: romperebbe
  le watchlist già costruite. Il listone li filtra in RAM, l'indice `byId` li include.

## Boot gate — due cancelli

`app/_layout.tsx` non monta lo `Stack` finché `runBootSequence` non ha finito: è
un'interruzione precoce della navigazione (US7-T4), non un overlay sopra una UI viva.
Migrazioni → verifica presenza dati → import se serve → idratazione store.

Il re-import avviene solo se la tabella `players` è vuota. Per forzarlo in sviluppo,
disinstalla l'app o svuota la tabella.

Subito dopo c'è un **secondo cancello della stessa natura**: se non esiste alcuna
configurazione d'asta, al posto dello `Stack` viene montato `ConfigurationWizard`.
Non è una route e non è scavalcabile — senza parametri d'asta la watchlist non
avrebbe dove scrivere. Appena il wizard crea la prima configurazione lo store cambia,
il ramo si spegne e la navigazione appare da sé.

La watchlist è l'unica idratazione **non** parallela: sapere quali assegnazioni
caricare richiede prima di sapere qual è la configurazione attiva.

## Mappa delle schermate

Attenzione all'assunzione sbagliata più facile: la tab `index` **non** è il listone.

- `app/(tabs)/index.tsx` — **Home: le configurazioni d'asta** (attiva / modifica /
  elimina). È la prima tab perché i parametri d'asta sono il contesto di tutto il resto.
- `app/(tabs)/listone.tsx` — il listone.
- `app/(tabs)/watchlist.tsx` — watchlist della configurazione attiva. Il badge sulla tab
  (in `app/(tabs)/_layout.tsx`) si sottoscrive al solo conteggio, così un'assegnazione
  aggiorna il numero senza ri-renderizzare le schermate.
- `app/player/[id].tsx` — **dettaglio calciatore** (US21): sezioni economiche, rendimento,
  metriche analitiche, rischio infortuni, heatmap. Ci si arriva toccando il **corpo** di
  una riga; il pulsante "+" a destra continua ad aprire `CategorySheet`. Le due azioni
  sono separate di proposito — sovrapporle renderebbe impossibile assegnare senza prima
  aprire una schermata.
- Fuori dalle tab: `app/configuration.tsx` (crea o modifica, parametro `?id=`) e
  `app/categories.tsx` (gestione delle categorie, che sono globali).

I conteggi watchlist delle configurazioni **non attive** non stanno nello store: in RAM
vive una lega sola. Si leggono con `countWatchlistByConfiguration()` dentro uno
`useFocusEffect` (vedi `index.tsx`) — una GROUP BY al focus costa meno che tenere in
memoria tutte le leghe. Non promuoverli a stato globale.

## Schema: deviazioni consapevoli dalle User Stories

Le US davano le categorie hardcoded e in due varianti contraddittorie (US3 vs US8-T1).
Scelta di prodotto: sono entità persistite ed editabili dall'utente. Da lì discendono
due scostamenti dal testo di US8-T1, entrambi voluti:

- `watchlist.category_id` FK invece di `category_name` testuale — rinominare una
  categoria non orfana le assegnazioni.
- `watchlist.player_id` UNIQUE — un giocatore in una categoria sola. Rende
  assegnazione e spostamento lo **stesso** statement (`ON CONFLICT DO UPDATE`).

Eliminare una categoria fa `ON DELETE CASCADE` sul DB; la mappa in memoria non lo sa e
va ripulita esplicitamente con `removeCategoryLocal` (lo fa già `categoryHook`).

## Configurazioni d'asta (schema v2)

`configurations` tiene partecipanti, crediti e slot per ruolo (`slot_p`…`slot_a`). Il
totale della rosa **non è una colonna**: è `rosaSize()`, la somma degli slot. Così il
numero mostrato e la composizione per reparto non possono divergere.

- **Una sola attiva alla volta** è un invariante applicativo, non un vincolo SQL:
  `setActiveConfiguration` spegne e riaccende nella stessa transazione. `activeId` nello
  store è *derivato* dal flag `is_active`, mai memorizzato a parte.
- **La watchlist è per configurazione**: `watchlist.config_id` + `UNIQUE(player_id,
  config_id)`. In RAM vive una lega sola, quella attiva; `useWatchlistStore.configId`
  dice quale, e `load()` scarta le letture stantie se nel frattempo è cambiata.
- **Le categorie restano globali**, condivise fra le leghe: sono etichette di metodo,
  non dati di lega. Conseguenza da ricordare: eliminarne una cancella assegnazioni anche
  in configurazioni che l'utente non ha sotto gli occhi — il messaggio di conferma lo
  dice esplicitamente.

La migrazione v1→v2 in `migrations.ts` **ricostruisce** `watchlist` (SQLite non sa
togliere un `UNIQUE` con un ALTER) e, se c'erano assegnazioni, crea una configurazione
ponte "La mia lega" che le adotta. `CREATE_TABLES_SQL` descrive lo schema nella forma
corrente e gira solo su `user_version = 0`; chi arriva da v1 passa dagli step. Se
aggiungi tabelle, aggiungi uno step *e* bumpa `SCHEMA_VERSION`.

La v2→v3 è l'opposto: **puramente additiva**, due `CREATE TABLE` (`player_stats`,
`dataset_meta`) e nessuna tabella esistente toccata. Gli step sono cumulativi — chi arriva
da v1 attraversa entrambi nello stesso avvio. `CREATE_TABLES_SQL` è composto per
concatenazione dalle stesse costanti usate dagli step, così le due strade non possono
divergere.

## Dataset remoto e metriche avanzate (Epic 4)

Il CSV imbarcato non è più l'unica fonte: è il **fallback**. La fonte primaria è un
dataset generato fuori dall'app e pubblicato su URL pubblico.

```
listone.csv (anagrafica di riferimento)
      |
      +-- [scripts/build_dataset.py] --> aggrega Understat, Fantacalcio.it,
      |                                  Transfermarkt, SofaScore
      v
dataset/players.json + manifest.json  --(commit)-->  raw.githubusercontent
                                                            |
                                              [syncEngine: manifest -> decidi -> payload]
                                                            v
                                              SQLite: players + player_stats
```

### La regola che attraversa tutto: `null` non è zero

Un giocatore appena arrivato in Serie A non ha "0 xG": non ha xG. Le colonne di
`player_stats` sono nullable **senza DEFAULT**, i tipi in `domain/playerStats.ts` sono
`number | null`, il mapper non converte, e la UI mostra "dato non disponibile". Il campo
`coverage` dice quali fonti hanno davvero risposto ed è ciò che distingue i due casi.
Trasformare un null in zero mostrerebbe all'utente un attaccante che non tira mai.

### Pipeline Python (`scripts/dataset/`)

- I provider implementano il `Protocol` in `providers/base.py` e sono registrati in
  `providers/__init__.py`. Aggiungerne uno = un file + una riga; l'orchestratore non
  conosce nessuna fonte in concreto.
- **Nessun provider importa `requests`**: passano tutti da `http.py`, unico posto dove
  vivono cache su disco, rate limit per host e retry. Toccare quel file cambia il
  comportamento di rete di tutta la pipeline.
- `resolver.py` è la parte critica (US19-T2) e ha i test più densi. Due invarianti da non
  rompere: il **ruolo portiere è un vincolo rigido** (`Martinez Jo.` portiere vs
  `Lautaro Martínez` attaccante, stessa squadra, stesso cognome), e la **squadra non lo
  è** — le metriche sono della stagione conclusa, il listone è di quella nuova, e i
  trasferimenti sono la norma.
- I contesi si assegnano **per confidenza**, non per ordine di arrivo: il primo "Colombo"
  del CSV non deve rubare le statistiche al Colombo titolare.
- Gli irrisolti stampati dal report sono la lista di lavoro per `manual_map.json`, che ha
  la precedenza su ogni euristica. Su Transfermarkt l'override scavalca anche la
  **ricerca**, non solo il matching: la ricerca restituisce una pagina sola, e per chi non
  ci compare (Josep Martinez fra i tanti "Martinez") un override che agisse solo sui
  candidati trovati sarebbe inutile proprio nel caso in cui serve.
- La cache in `.cache/` non è opzionale: Transfermarkt costa due richieste per giocatore.

### Motore di sincronizzazione (`src/core/sync/`)

- `syncEngine.ts` **non importa né `fetch` né SQLite**: riceve sorgente, lettura versione
  e scrittura come funzioni. È ciò che rende testabile in Jest tutta la logica di
  decisione ed errore. Il cablaggio reale sta in `syncService.ts`, l'unico file "sporco".
- Il confronto di versione è sull'**hash del contenuto**, non sulla data: rigenerare il
  dataset senza che le fonti siano cambiate non fa scaricare nulla a nessuno.
- Il **fallback offline non è un ramo speciale**: `BundledSource` è un'altra
  implementazione della stessa porta, e passa dallo stesso motore e dalla stessa
  transazione. Un `if (offline)` dentro il motore sarebbe la classica strada che smette
  di funzionare perché nessuno la percorre.
- **Policy di avvio**: DB vuoto → sync bloccante con fallback al CSV; DB pieno → boot
  immediato e sync in background (`bootHook.ts`, nodo 5, deliberatamente non atteso come
  gli `effect` della pipeline).
- **US20-3, da non violare**: il sync non tocca mai `watchlist`, `categories`,
  `configurations`. I giocatori spariti dal dataset vengono spenti con `is_active = 0` —
  mai un DELETE, che il CASCADE trasformerebbe in perdita di dati dell'utente.
- L'URL sta in `app.json` → `expo.extra.datasetUrl`. Vuoto = solo CSV bundlato, senza errori.

### Metriche in RAM: la deroga consapevole

`player_stats` **non** viene idratata al boot, a differenza del listone. Il listone sta in
RAM perché lo scroll lo attraversa tutto; le metriche si leggono una riga per volta su tap
esplicito (`usePlayerStatsStore`), fuori dal percorso caldo. L'invariante "filtri e ricerca
non toccano il DB" resta intatta.

## Layer agentico

`src/agent/` è scaffolding tipizzato ed eseguibile via `executeTool`, ma nessun modello
lo invoca: non c'è runtime LLM, né client, né API key. `input_schema` è JSON Schema in
forma provider-agnostica.

Il vincolo da preservare: i tool non parlano con i repository. `assignPlayer.ts` passa
dalla stessa `assignmentPipeline` del bottone UI, così un'azione dell'agente e un tap
dell'utente restano la stessa operazione per costruzione. Mantieni questa proprietà
quando aggiungi tool mutanti (marcali con `mutating: true`).

Prima di scrivere un client LLM reale, consulta la skill `claude-api`.

## Test

I test coprono **solo logica pura** — nessuna dipendenza nativa, nessun SQLite. Le suite
in `__tests__/` rispecchiano i moduli puri corrispondenti: `listoneMapper`, `selectors`,
`pipeline`, `configuration`, `datasetMapper`, `syncEngine`, `metrics`.

La pipeline Python ha i propri test (`npm run dataset:test`, unittest stdlib): coprono
normalizzazione dei nomi ed entity resolution, senza rete.

`dispatch()` restituisce `persisted`, una Promise che si risolve a `effect` completato.
La UI la ignora di proposito; **i test la attendono** per asserire dopo la persistenza
senza `sleep` arbitrari. Se aggiungi un test su un hook della pipeline, usa
`await result.persisted`.

Atteso e non un guasto: `pipeline.test.ts` verifica che un `effect` fallito non propaghi
alla UI e `syncEngine.test.ts` che un record rotto venga scartato, quindi `npm test`
stampa dei `console.warn` pur restando verde.

## Convenzioni

- Commenti e stringhe UI in italiano; identificatori in inglese, tranne i campi che
  replicano il tracciato ufficiale del listone (`qt_a`, `fvm_m`, `squadra`).
- Alias `@/*` → `src/*`, risolto da `tsconfig.json` (babel-preset-expo lo legge da lì,
  non c'è module-resolver) e da `moduleNameMapper` in Jest.
- `noUncheckedIndexedAccess` è attivo: gli accessi indicizzati restituiscono
  `| undefined` e vanno gestiti.
- La mappatura colori dei ruoli (P giallo, D verde, C blu, A rosso) vive in
  `src/domain/roles.ts`, non nel theme: è un criterio di accettazione, non estetica.
- Tema scuro fisso, senza variante chiara.

## Stato di verifica

Ultima verifica il 17/08/2026 su Node 24.19 / npm 11.17 e Python 3.12.12:
`npm run typecheck` pulito, `npm test` verde (83 test, 8 suite), `npm run dataset:test`
verde (21 test), `npx expo export --platform android` compila l'intero bundle
(1116 moduli) senza errori.

L'Epic 1 (listone + watchlist) è stata provata a runtime e funziona.

La pipeline dataset è stata eseguita per intero contro le fonti reali. Copertura sul
listone 2026/27: Fantacalcio.it 389/505 (il tetto naturale — sono i giocatori con
presenze in Serie A la scorsa stagione), Understat 369/505, Transfermarkt ~420/505.
SofaScore risponde **403** a ogni richiesta programmatica: il provider è scritto e
registrato, ma dichiara il fallimento e la pipeline prosegue senza heatmap.

**Non ancora verificato a runtime**:

- Le configurazioni d'asta, in particolare la **migrazione v1→v2**, da provare su
  un'installazione *esistente* con assegnazioni già presenti (deve comparire la
  configurazione ponte con la watchlist intatta).
- La **migrazione v2→v3** su un DB esistente (deve creare `player_stats` e `dataset_meta`
  lasciando la watchlist intatta).
- Il **sync HTTP reale**: `expo.extra.datasetUrl` punta a `raw.githubusercontent`, ma
  `dataset/` non è ancora stato committato e pushato. Finché non lo è, l'app riceve un 404
  e ricade sul CSV bundlato — comportamento corretto ma che nasconde il percorso remoto.
  La compatibilità del formato è comunque verificata sui file veri da
  `__tests__/datasetContract.test.ts`.

Note operative emerse alla prima esecuzione:

- `react-dom` è fissato a 19.1.0 in `dependencies` anche se l'app non ha target web:
  `expo-router` lo tira dentro come peer opzionale e npm risolverebbe una 19.2.x
  incompatibile con `react@19.1.0`, facendo fallire in ERESOLVE **qualunque**
  `npm install`. Non rimuoverlo e non sbloccarne la versione senza aggiornare React.
- `babel-preset-expo` è una devDependency esplicita: in SDK 54 non arriva più come
  transitiva di `expo`, e senza di essa Jest muore nel transform prima di eseguire
  un solo test.
- Python 3.12 è installato (`C:\Users\tonyg\anaconda3\envs\llm_env\python.exe`, invocabile
  come `python`) con `pandas`, `requests`, `bs4` e `lxml` già presenti: `npm run listone` e
  `npm run dataset` sono eseguibili senza installare nulla. La pipeline dataset usa solo
  `requests` + `bs4`; normalizzazione e matching sono stdlib.
- La console di Windows parte in cp1252: `build_dataset.py` forza UTF-8 su stdout, o i
  nomi accentati farebbero fallire una generazione da dieci minuti sull'ultima riga di
  stampa.
- Node 24 è più recente di quanto SDK 54 supporti ufficialmente (20/22). Toolchain a
  posto; se il bundler desse errori inattesi, provare prima Node 22 LTS.
