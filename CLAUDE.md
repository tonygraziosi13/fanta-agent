# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cos'è

App mobile React Native (Expo) per il fantacalcio: configurazioni d'asta, consultazione
offline del listone Serie A, watchlist con categorie personalizzabili e metriche avanzate
per calciatore, scaricate da un dataset remoto versionato. Predisposta per una parte
agentica LLM che non è ancora implementata.

Il codice cita le User Story nei commenti (es. "US4-T2", "US20-3"), ma il documento è
nel repository **solo per l'Epic 4**: `user-story.md` contiene US19 (pipeline dataset),
US20 (sync engine) e US21 (dettaglio calciatore) con i criteri di accettazione per
esteso. Leggilo prima di toccare `scripts/dataset/`, `src/core/sync/` o
`app/player/[id].tsx`.

Le US dello **Sprint 1** (US1–US8) invece non ci sono, e non vanno ricostruite:
sopravvivono in due posti soltanto — i commenti di intestazione dei moduli
(`pipeline.ts`, `assignmentHook.ts`, `app/_layout.tsx`…), che spiegano il *perché* di
ogni vincolo, e la tabella di copertura in `README.md`. Quando tocchi codice marcato
`US…`, leggi prima il commento del modulo: diversi vincoli apparentemente arbitrari sono
criteri di accettazione. Le configurazioni d'asta sono invece fuori dalle US: nascono
dopo, e sono descritte più sotto.

Nemmeno la history git è una fonte di contesto: tre commit in tutto, e il secondo
("Funzionalità base pre motore AI") introduce l'intero codebase in blocco. Nessuna
scelta di design ha un commit che la spieghi.

## Comandi

```bash
npm install            # Node LTS 20+ richiesto
npx expo start         # dev server; scansiona il QR con Expo Go
npm test               # Jest — solo logica pura, nessuna dipendenza nativa
npm run typecheck      # tsc --noEmit, strict + noUncheckedIndexedAccess
npm run listone        # aggiorna assets/data/listone.csv (login se le credenziali ci sono)
npm run listone:xlsx   # riserva offline: rigenera il CSV da un .xlsx scaricato a mano
npm run dataset        # rigenera dataset/players.json dalle fonti esterne (lento)
npm run dataset:test   # unittest della pipeline Python (istantanei, senza rete)

python scripts/check_release.py <baseline>   # gate di rilascio: pubblicare o no

npm test -- selectors                    # un solo file di test
npm test -- -t "combina ricerca"         # un solo caso
npx expo install --fix                   # allinea le versioni dei pacchetti Expo

npm run dataset -- --only understat --limit 30   # prova rapida → scrive in dataset/preview/
npm run dataset -- --only understat --force      # ...e invece sovrascrive dataset/ davvero
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
Fantacalcio.it  --[login Playwright: .xlsx ufficiale]--+
                                                       |
                --[scraping pagina pubblica: riserva]--+--[refresh_listone.py]--> listone.csv
                                                                                     |
Quotazioni_*.xlsx  --[xlsx_to_csv.py: conversione a mano]----------------------------+
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
- **Il listone non è più un artefatto manuale, e ha due strade.** `npm run listone`
  prova prima il **download autenticato**: login con un browser headless (Playwright) e
  scaricamento dell'`.xlsx` ufficiale, che è riservato agli utenti registrati. Se non è
  percorribile — credenziali assenti, Playwright non installato, sito che rifiuta l'IP —
  ricade da solo sullo **scraping della pagina pubblica**, che non richiede login. Il
  fallback non è un ramo d'emergenza da riscoprire il giorno del guasto: è il percorso
  che ha retto finora, ed è quello che tiene in piedi il rilascio automatico se un runner
  CI non riesce ad autenticarsi.
- **Le credenziali stanno in `FANTACALCIO_USER` / `FANTACALCIO_PASS`**, mai nel codice;
  in CI arrivano da GitHub Secrets. La sessione salvata vive in `.cache/session/`,
  deliberatamente **fuori** da `.cache/dataset/`: quest'ultima finisce nella cache di
  GitHub Actions, che è leggibile da chiunque abbia accesso in lettura al repository, e
  non è il posto dove lasciare i cookie di un account reale.
- **`IsActive` ha due letture indipendenti, e servono entrambe.** Dall'`.xlsx` viene dai
  *fogli*: "Tutti" è la rosa reale, "Ceduti" chi è uscito. Dalla pagina viene dal
  marcatore `out-of-game`. Quando divergono vince la pagina — è ciò che il sito mostra
  adesso, mentre il file è una fotografia. È l'unico modo di riconoscere un ceduto,
  perché l'elenco ufficiale **non toglie nessuno**: i venduti restano con la loro
  quotazione, e senza quel flag tornerebbero acquistabili.
- La fonte espone lo **stesso `Id`** del listone nell'href di ogni giocatore, quindi la
  join con `fantacalcio_stats` è esatta e non passa dal resolver.
- Il refresh va lanciato **prima** di `npm run dataset`: la pipeline costruisce le
  metriche attorno all'anagrafica del CSV, quindi un listone fermo produce un dataset
  fermo per quanto fresche siano le fonti delle statistiche. Nel workflow l'ordine è già
  cablato.
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
  metriche analitiche, rischio infortuni. Ci si arriva toccando il **corpo** di
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
      +-- [scripts/build_dataset.py] --> cascata a 3 livelli:
      |                                  Fantacalcio.it -> Understat (top 5)
      |                                  -> FBref -> Transfermarkt
      v
dataset/players.json + manifest.json  --(commit)-->  GitHub Pages
                                                            |
                                              [syncEngine: manifest -> decidi -> payload]
                                                            v
                                              SQLite: players + player_stats
```

**Il commit su `main` è il rilascio** (US19-4): Pages serve la radice del branch, quindi
`dataset/manifest.json` è già l'URL che sta in `app.json`, senza altri passaggi. Due
dettagli non deducibili dal codice: la propagazione non è istantanea come su
`raw.githubusercontent` (qualche minuto fra push e file servito), e `.nojekyll` in radice
**non va cancellato** — senza, Pages passa da Jekyll, che scarta i percorsi con
l'underscore iniziale e cambia cosa viene davvero servito. L'hosting resta comunque
intercambiabile per costruzione: `datasetSource.ts` è la porta che esiste apposta perché
il motore non debba saperlo.

### Il rilascio lo fa un workflow (US19-T3)

`.github/workflows/dataset.yml` rigenera il dataset ogni lunedì — e su
`workflow_dispatch` — e lo committa da sé. Fra la generazione e il commit sta
`scripts/check_release.py`, che non è un passaggio burocratico: `build_dataset.py`
**ritorna 0 anche se tutte le fonti falliscono**. È il comportamento giusto in locale,
dove un umano legge il report prima di committare; a monte di un commit automatico
significherebbe pubblicare un dataset a copertura zero sopra uno buono. Il gate ha tre
uscite, e vanno conosciute tutte e tre:

| esito | quando | effetto |
|---|---|---|
| `publish` | versione nuova, nessuna fonte in regressione | commit e push |
| `unchanged` | hash identico a quello già pubblicato | nessun commit |
| `regression` | una fonte è caduta, o è scesa sotto il 70% del suo `matched` | **job rosso**, il dataset online resta |

Un job rosso che dice "RILASCIO BLOCCATO" è il gate che fa il suo lavoro, non un guasto
del workflow: stessa natura dei `console.warn` attesi in `npm test`.

Due scelte del gate che sembrano arbitrarie e non lo sono. Il confronto è con la
**baseline reale**, non con un ideale — FBref viene respinto da Cloudflare a periodi, e
chiamarlo regressione ogni volta renderebbe l'allarme una luce sempre accesa. È anche
ciò che permette di *togliere* una fonte ormai inutile senza bloccare il primo rilascio
successivo: è così che SofaScore è uscito dalla pipeline senza far scattare il gate. E `unchanged`
esiste perché `generated_at` finisce nei file ma è escluso dall'hash: senza quella
uscita, ogni esecuzione settimanale committerebbe un file diverso che dice la stessa
cosa.

La decisione vive in `scripts/dataset/release.py` — puro, stdlib, testato in
`tests/test_release.py` — e la CLI è sottile come `build_dataset.py`. Le dipendenze
della pipeline sono ora dichiarate in `scripts/requirements.txt`: erano implicite
nell'ambiente della macchina di sviluppo, e un runner CI non ce l'ha.

Il workflow fa girare anche `npx jest datasetContract` **prima** di pubblicare: il test
esisteva già, e metterlo lì sposta il controllo sul contratto Python↔TypeScript da
"dopo, sul telefono" a "adesso, prima del commit".

### La regola che attraversa tutto: `null` non è zero

Un giocatore appena arrivato in Serie A non ha "0 xG": non ha xG. Le colonne di
`player_stats` sono nullable **senza DEFAULT**, i tipi in `domain/playerStats.ts` sono
`number | null`, il mapper non converte, e la UI mostra "dato non disponibile". Il campo
`coverage` dice quali fonti hanno davvero risposto ed è ciò che distingue i due casi.
Trasformare un null in zero mostrerebbe all'utente un attaccante che non tira mai.

### La cascata a tre livelli, e perché l'ordine dei provider ora conta

Fino alla migrazione dei PoC ogni fonte girava su tutto il listone e il merge era
commutativo. Adesso **l'ordine del registro in `providers/__init__.py` è la cascata**:
ogni provider riceve un `CascadeState` che dice cosa i livelli precedenti hanno già
coperto, e decide se può risparmiarsi le richieste.

| # | fonte | costo | copre | su chi |
|---|---|---|---|---|
| 0 | `fantacalcio` | 1 pagina | rendimento ufficiale, **unica fonte di media voto e fantamedia** | tutti, join esatta per `Id` |
| 1 | `understat` | 5 richieste | le 8 metriche analitiche, `xGChain`/`xGBuildup` compresi | tutti |
| 2 | `fbref` | ~2 richieste **per giocatore** | xg, npxg, xa, tiri, passaggi chiave | solo chi il livello 1 non ha risolto |
| 3 | `transfermarkt` | ~2 richieste per giocatore | infortuni per **tutti**; rendimento grezzo | rendimento solo per chi è ancora scoperto |

Tre cose non deducibili dal codice:

- **Understat legge le top 5 leghe, non la sola Serie A.** Con la sola Serie A la
  copertura si fermava a 371/521, e non era un difetto di matching: chi arriva
  dall'estero non ha righe nella Serie A conclusa, e nessuna correzione del resolver le
  inventa. Cinque leghe costano cinque richieste — l'indice è per lega, non per
  giocatore — e la Serie A pesca da lì quasi tutti i suoi acquisti. I valori restano
  **grezzi**: nessun moltiplicatore di lega, un xG in Ligue 1 pesa come uno in Serie A.
- **Il livello 1 scrive solo `minuti` a chi ha già il rendimento ufficiale.**
  `builder.merge_section` sovrascrive un non-null con un altro non-null: senza quel
  vincolo, le presenze di un'altra lega cancellerebbero quelle italiane appena scritte da
  Fantacalcio.it. Coerentemente, `CascadeState.absorb` **non** considera i soli minuti
  come copertura del rendimento — chi ha solo quelli deve restare in coda per il livello 3.
- **Il nome per esteso viaggia fra i livelli** (`state.full_names`). La ricerca di
  Transfermarkt mostra dieci risultati: "Martinez" restituisce Lautaro, Emiliano e Javi
  ma non Josep. Quando il livello 1 ha già identificato il giocatore, il livello 3 cerca
  col nome completo e lo trova.

### FBref e l'interruttore automatico

FBref sta dietro Cloudflare e da certi indirizzi risponde 403 a qualunque richiesta non
fatta da un browser. Quando succede, succede per tutti: dopo `FBREF_MAX_FAILURES` rifiuti
consecutivi il livello 2 **si spegne da solo** per il resto della corsa. Insistere
costerebbe tre secondi a giocatore per nulla.

Un 404 non apre l'interruttore, e la distinzione è voluta: un giocatore introvabile non
dice nulla sulla nostra possibilità di leggere il sito, e spegnere il livello per lui
significherebbe perdere tutti quelli dopo. È il motivo per cui `HttpError` porta con sé
lo `status`.

Un livello 2 spento **non è una regressione**: fino a ieri non c'era. Il gate di rilascio
lo tratta come qualunque fonte con baseline zero e non blocca.

### Il delta di esecuzione (`delta.py`)

Una generazione completa è ~1500 richieste, ma fra due esecuzioni il listone cambia di
una decina di giocatori. Si rielabora solo chi ha qualcosa da guadagnarci: i nuovi, i
falliti (spesso un 403 di passaggio), chi non ha un livello registrato, e chi era
arrivato al livello 1 **senza** metriche — che è una contraddizione.

Chi si è fermato al livello 3 con le metriche a null **non** si ripete: lì non c'è altro
da prendere, e rifarlo a ogni avvio impedirebbe al delta di svuotarsi mai. `--full`
ignora tutto e rigenera.

Lo stato sta in `.cache/dataset/levels.json` e non in `dataset/`: non descrive i
giocatori, descrive *come* li abbiamo ottenuti. In `dataset/` entrerebbe nell'hash e
farebbe cambiare versione a ogni corsa. Se sparisce, il peggio è una rigenerazione
completa.

Conseguenza da conoscere: con il delta, la copertura della *corsa* e quella del *dataset*
divergono. Nel payload finisce la seconda (`report.summarize_dataset`), altrimenti il
gate leggerebbe ogni corsa incrementale come un crollo del 98% e bloccherebbe la
pubblicazione di un dataset intatto.

### Pipeline Python (`scripts/dataset/`)

- I provider implementano il `Protocol` in `providers/base.py` e sono registrati in
  `providers/__init__.py`. Aggiungerne uno = un file + una riga; l'orchestratore non
  conosce nessuna fonte in concreto.
- **Nessun provider importa `requests`**: passano tutti da `http.py`, unico posto dove
  vivono cache su disco, rate limit per host, retry **e la sicurezza rispetto ai
  thread**. Toccare quel file cambia il comportamento di rete di tutta la pipeline.
- **La pipeline è multi-thread** (`config.MAX_WORKERS`, quattro). Tre conseguenze in
  `http.py`: una `requests.Session` per thread (non è garantita thread-safe), il throttle
  sotto lock, e la cache scritta in modo atomico — due thread sullo stesso URL
  producevano un file troncato che al giro dopo veniva riletto come valido.
- La cortesia verso le fonti è **per host** e vive in `config.HOST_LIMITS`: quante
  richieste insieme e quanto distanziate. È lì che FBref è pinnato a *un* solo slot ogni
  tre secondi, senza che il suo provider debba saperlo.
- La fase 1 di Transfermarkt gira in parallelo ma **raccoglie i risultati nell'ordine del
  listone**: a parità di confidenza deve vincere sempre lo stesso, o il dataset
  cambierebbe a seconda di quale thread ha finito prima — e il gate lo leggerebbe come
  contenuto nuovo a ogni esecuzione.
- `resolver.py` è la parte critica (US19-T2) e ha i test più densi. Due invarianti da non
  rompere: il **ruolo portiere è un vincolo rigido** (`Martinez Jo.` portiere vs
  `Lautaro Martínez` attaccante, stessa squadra, stesso cognome), e la **squadra non lo
  è** — le metriche sono della stagione conclusa, il listone è di quella nuova, e i
  trasferimenti sono la norma.
- I contesi si assegnano **per confidenza**, non per ordine di arrivo: il primo "Colombo"
  del CSV non deve rubare le statistiche al Colombo titolare.
- La **sigla societaria si toglie per struttura**, non per elenco (`_strip_club_form`).
  La vecchia tabella di alias non conosceva "ac monza", e il portiere del Monza restava
  scoperto pur avendo davanti un candidato con cognome, ruolo e squadra giusti: nessun
  errore, solo un match in meno. Gli alias restano per ciò che la struttura non deduce
  ("internazionale" → "inter"). Rimetterci una tabella da inseguire a ogni promozione
  costa 55 match.
- **La query di ricerca non può usare la forma del confronto.** `normalize_text`
  trasforma i trattini in spazi — corretto per far collassare "Milinkovic-Savic" e
  "Milinkovic Savic" — ma su Transfermarkt "norton cuffy" restituisce zero risultati e
  "norton-cuffy" restituisce esattamente lui. `_search_variants` ritenta col trattino e
  con l'ultimo token, **solo dopo un buco**: chi si risolve al primo colpo non paga
  richieste in più.
- Gli irrisolti stampati dal report sono la lista di lavoro per `manual_map.json`, che ha
  la precedenza su ogni euristica. **Verificali dalla rosa del club**
  (`/kader/verein/<id>/saison_id/<anno>`), non dalla ricerca: dentro una squadra un
  cognome e' quasi sempre unico, e la squadra e' un fatto controllabile, mentre la
  ricerca globale restituisce una pagina sola di omonimi mondiali — che e' proprio il
  motivo per cui quei giocatori sono finiti nella lista. Due trappole: la rosa va chiesta
  per la stagione **corrente** (gli acquisti recenti non sono in quella prima), e i nomi
  vanno normalizzati prima del confronto ("N'Dri" non e' sottostringa di "Konan N'Dri"
  finche' l'apostrofo resta). Dove il cognome ricorre due volte decide l'iniziale del
  listone. Su Transfermarkt l'override scavalca anche la
  **ricerca**, non solo il matching: la ricerca restituisce una pagina sola, e per chi non
  ci compare (Josep Martinez fra i tanti "Martinez") un override che agisse solo sui
  candidati trovati sarebbe inutile proprio nel caso in cui serve.
- La cache in `.cache/dataset/` non è opzionale: Transfermarkt costa due richieste per
  giocatore. Accanto vive `levels.json`, lo stato del delta. `.cache/session/` è invece
  un'altra cosa e sta apposta fuori: contiene i cookie di login (vedi "Flusso dei dati").

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
- Il timeout del manifest (`remoteHttpSource.ts`) è tarato sulla latenza di un **rifiuto
  lento**, non di un successo: GitHub ritarda di qualche secondo le risposte 429, e con
  6s l'app abortiva prima di ricevere lo stato, riportando "Aborted" al posto della causa
  vera. Se lo riduci, torna quel bug.
- `selectSyncNotice` riporta la causa **anche** per gli errori transitori: "nessuna
  connessione" da solo copriva indistintamente il telefono in galleria, il 429 e l'URL
  irraggiungibile, e mandava a caccia della causa sbagliata.

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

`datasetContract.test.ts` è l'unico che legge dal disco: verifica sui file veri in
`dataset/` che il formato scritto da `scripts/build_dataset.py` sia quello che
`datasetSchema.ts` accetta. Sono due linguaggi e due file distinti, e nessun altro test
impedirebbe a un campo rinominato da un lato di passare inosservato fino al telefono. Se
`dataset/` non è stato generato la suite si salta invece di fallire — un clone fresco
senza pipeline eseguita è una situazione legittima.

La pipeline Python ha i propri test (`npm run dataset:test`, unittest stdlib): coprono
normalizzazione dei nomi, entity resolution, gate di rilascio, parsing dei provider,
**la cascata e il delta** (`test_cascade.py`), **FBref** (`test_fbref.py`) e la lettura
dell'`.xlsx` (`test_listone_xlsx.py`) — tutti senza rete.

Due di questi meritano una nota, perché coprono regole che *non si rompono in modo
rumoroso*. Una cascata che smette di filtrare continua a produrre un dataset corretto,
pagando però mille richieste in più a fonti che poi ci rifiutano. Un parser FBref che
ignorasse i commenti HTML restituirebbe tiri e passaggi chiave sempre a null, che sembra
un giocatore che non tira mai. Nessun altro test intercetterebbe le due cose.

`test_listone_xlsx.py` costruisce l'.xlsx da zero con `zipfile`, senza file di prova da
versionare: un .xlsx *è* uno ZIP di XML.

Unica eccezione alla regola "niente rete", **saltata per default**:

```bash
FANTA_LIVE=1 npx jest liveDataset          # bash
```

```powershell
$env:FANTA_LIVE=1; npx jest liveDataset    # PowerShell, la shell primaria qui
```

Da lanciare dopo ogni pubblicazione. È l'unico test che esercita `RemoteHttpSource`
contro l'URL di `app.json`, cioè l'anello che i test offline non possono coprire: URL
sbagliato, file non pubblicato, repository tornato privato, HTML servito al posto del
JSON. Legge l'URL da `app.json` e non da `expo-constants`, che sotto Jest è un mock
vuoto (a runtime la configurazione arriva invece dal manifest, verificabile con
`npx expo config --type public`).

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

Ultima verifica il 20/08/2026 su Node 24.19 / npm 11.17 e Python 3.12.12, dopo la
migrazione dei PoC nella pipeline ufficiale: `npm run typecheck` pulito, `npm test` verde
(9 suite, 82 test passati + 3 saltati — sono i tre di `liveDataset`, che senza
`FANTA_LIVE=1` non escono in rete), `npm run dataset:test` verde (85 test: cascata,
delta, FBref, lettura dell'.xlsx, gate di rilascio, refresh del listone e regressioni del
matching).

L'Epic 1 (listone + watchlist) è stata provata a runtime e funziona.

**La pipeline è stata eseguita per intero contro le fonti reali** (521 giocatori,
versione `5d5b4a2e531913bc`):

| fonte | copertura | note |
|---|---|---|
| Fantacalcio.it | 393/521 (75.4%) | join esatta per `Id`; il resto non ha giocato in Serie A |
| Understat | **397/521** (76.2%) | era 371 con la sola Serie A |
| FBref | 0/521 | **403 di Cloudflare**, interruttore scattato dopo 3 richieste |
| Transfermarkt | 513/521 (98.5%) | gli 8 residui sono ambiguità da `manual_map.json` |

Tre letture da non confondere:

- **Le top 5 leghe hanno alzato Understat di 26 giocatori**, non di cento. Il guadagno
  reale è minore di quanto la sola idea suggerisca: buona parte degli irrisolti sono terzi
  portieri e ragazzi dalla Serie B (Daffara, Palmisani, Desplanches, Happonen…), che in
  nessuna delle top 5 hanno mai giocato. È FBref che servirebbe per loro, ed è proprio
  quello che oggi non risponde.
- **FBref respinge da questa macchina.** L'interruttore ha funzionato come previsto — tre
  rifiuti e via, invece di venti minuti di attese inutili — ma il livello 2 al momento
  non produce nulla. Non è una regressione: fino a ieri quel livello non esisteva, la
  copertura è quella di prima più i 26 di Understat, e il gate lo tratta come qualunque
  fonte con baseline zero. Resta da capire se risponda da un IP diverso.
- **Il delta e l'hash sono coerenti fra loro.** Una seconda corsa rielabora 1 giocatore,
  ne riprende 520 e produce **la stessa versione**; `check_release.py` risponde
  `unchanged` e non pubblica. Ci è voluta una correzione per arrivarci: `strategies` e
  `failed` descrivevano la *corsa* e in una corsa incrementale si azzeravano, cambiando
  l'hash senza che un dato fosse cambiato. Ora, quando la corsa non attraversa tutto il
  listone, si riportano dalla volta prima.

Verificato anche che `check_release.py` esce `publish` contro la baseline committata: la
sparizione di SofaScore **non** blocca il gate, perché era già una fonte a copertura zero
e `release.py` la intercetta prima del controllo "sparita dal payload".

**Non ancora verificato a runtime**:

- Il **download autenticato del listone**. Il codice c'è e il fallback senza login è
  quello già collaudato, ma il percorso Playwright non è mai stato eseguito con
  credenziali vere: servono `FANTACALCIO_USER` / `FANTACALCIO_PASS`. Finché non lo si
  prova, `npm run listone` passa dalla pagina pubblica e lo dice.
- Le configurazioni d'asta, in particolare la **migrazione v1→v2**, da provare su
  un'installazione *esistente* con assegnazioni già presenti (deve comparire la
  configurazione ponte con la watchlist intatta).
- La **migrazione v2→v3** su un DB esistente (deve creare `player_stats` e `dataset_meta`
  lasciando la watchlist intatta).
- Il **workflow di rilascio**: scritto e provato in locale in tutte e tre le uscite del
  gate, ma **mai eseguito su un runner**. La domanda aperta è se Transfermarkt e
  Fantacalcio.it rispondano a un IP datacenter come già FBref non fa da qui: in caso
  contrario il gate blocca (comportamento corretto) ma il rilascio automatico non
  produce nulla di utile, e la strada diventa generazione locale + workflow di sola
  pubblicazione. Da misurare con un `workflow_dispatch` a `limit: 30`.
- Il **sync su dispositivo**. La catena rete → validazione → mappatura è invece già
  verificata contro l'URL pubblicato: `FANTA_LIVE=1 npx jest liveDataset` scarica il
  dataset vero e conferma anche l'early exit a versione allineata. Quel che resta da
  provare a mano è solo la scrittura su SQLite e la ri-idratazione degli store. Da
  rilanciare **dopo** aver pubblicato il dataset nuovo: quello online è ancora il
  precedente, con `heatmap` e `sofascore`.

Note operative emerse alla prima esecuzione:

- `react-dom` è fissato a 19.1.0 in `dependencies` anche se l'app non ha target web:
  `expo-router` lo tira dentro come peer opzionale e npm risolverebbe una 19.2.x
  incompatibile con `react@19.1.0`, facendo fallire in ERESOLVE **qualunque**
  `npm install`. Non rimuoverlo e non sbloccarne la versione senza aggiornare React.
- `babel-preset-expo` è una devDependency esplicita: in SDK 54 non arriva più come
  transitiva di `expo`, e senza di essa Jest muore nel transform prima di eseguire
  un solo test.
- Python 3.12 è installato (`C:\Users\tonyg\anaconda3\envs\llm_env\python.exe`, invocabile
  come `python`) con `requests`, `bs4`, `lxml` e `playwright` già presenti: `npm run listone`
  e `npm run dataset` sono eseguibili senza installare nulla.
- **Le librerie adottate ufficialmente per la pipeline dati** sono `requests`,
  `beautifulsoup4` (+`lxml` come parser) e `playwright`, quest'ultima per il solo
  download autenticato del listone; sono dichiarate in `scripts/requirements.txt`. Il
  parallelismo usa `concurrent.futures.ThreadPoolExecutor` della stdlib: nessun framework
  asincrono, e nessuna dipendenza in più per una cosa che il modulo standard fa già.
  Normalizzazione, matching, lettura dell'`.xlsx`, export e gate di rilascio restano
  stdlib pura — in particolare `listone_xlsx.py` non usa né pandas né openpyxl, perché un
  .xlsx è uno ZIP di XML e quel pezzo di catena deve funzionare su un runner appena
  creato. `playwright` ha un secondo passo oltre `pip install`
  (`playwright install --with-deps chromium`): senza, il download autenticato non parte,
  lo dice, e si ricade sulla pagina pubblica.
- La console di Windows parte in cp1252: `build_dataset.py` forza UTF-8 su stdout, o i
  nomi accentati farebbero fallire una generazione da dieci minuti sull'ultima riga di
  stampa.
- Node 24 è più recente di quanto SDK 54 supporti ufficialmente (20/22). Toolchain a
  posto; se il bundler desse errori inattesi, provare prima Node 22 LTS.
