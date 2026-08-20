# EPIC 4: Sincronizzazione Dinamica e Analisi Avanzata

Questo documento definisce i requisiti per la generazione del dataset remoto (US19), il motore di sincronizzazione (US20) e la visualizzazione del dettaglio calciatore (US21).
**ATTENZIONE:** Prima di implementare questi task, leggere le invarianti architetturali descritte in `CLAUDE.md`.

---

## US 19: Generazione Dataset Arricchito e Ponderazione (Pipeline Python)

**Come** sistema
**Voglio** aggregare i dati storici e le metriche avanzate dei calciatori in un JSON remoto, gestendo dinamicamente i nuovi acquisti dall'estero
**Affinché** l'applicazione mobile disponga di un dataset completo e normalizzato senza calcoli onerosi sul dispositivo.

### Criteri di Accettazione e Vincoli Architetturali:
1. **Nessuna dipendenza esterna invasiva:** È categoricamente vietato l'uso di librerie come `soccerdata`. I nuovi provider (es. `fbref.py`) devono estendere `providers/base.py` e far passare ogni chiamata di rete attraverso `http.py` per preservare cache e rate limiting.
2. **Targeted Fallback (Nuovi Acquisti):** Se un calciatore presente nel CSV base (Fantacalcio) non trova corrispondenze nei dataset della Serie A, lo script deve interpellare il provider Transfermarkt per recuperare l'ultima stagione giocata in qualsiasi campionato.
3. **League Weighting:** Le statistiche grezze recuperate dall'estero (gol, assist, minuti) devono essere moltiplicate per un coefficiente legato al Ranking UEFA del campionato di provenienza (es. Premier=1.0, Eredivisie=0.85, Serie B=0.70).
4. **L'invariante del Null:** I dati non disponibili devono restare rigidamente `null` e mai convertiti in `0`. Se le fonti non coprono un dato, la proprietà `coverage` del JSON rifletterà la mancanza.
5. **Output:** Il file `players.json` e il file `manifest.json` devono essere generati rispettando fedelmente il contratto definito in `datasetSchema.ts`.

### Task Tecnici:
*   **T1:** Creazione provider `fbref.py` (o simili) estendendo `base.py` e `http.py`.
*   **T2:** Modifica di `resolver.py` per implementare il calcolo del delta e la ricerca fallback su Transfermarkt per i giocatori "orfani".
*   **T3:** Implementazione del dizionario di ponderazione e applicazione dei moltiplicatori nella fase di reduce/normalizzazione prima della scrittura del JSON.

---

## US 20: Motore di Sincronizzazione Dati (Sync Engine)

**Come** fantallenatore
**Voglio** che l'app scarichi automaticamente il dataset aggiornato al lancio
**Affinché** le statistiche e le quotazioni siano allineate senza sovrascrivere le mie watchlist.

### Criteri di Accettazione e Vincoli Architetturali:
1. **Integrità Dati:** La sincronizzazione agisce solo su anagrafica e metriche. Non deve mai toccare le tabelle `watchlist`, `categories` e `configurations`.
2. **Gestione Cessioni:** I giocatori scomparsi dal nuovo dataset devono essere disattivati (`is_active = 0`), mai eliminati con DELETE (per evitare perdite a cascata).
3. **Policy di Rete e Early Exit:** Sfruttare `syncEngine.ts`. Il sync verifica l'hash del `manifest.json`. Se è identico, esegue un early exit istantaneo. In assenza di rete, sfrutta il CSV fallback silenziosamente.

### Task Tecnici:
*   **T1:** Verificare/completare la migrazione v2→v3 (puramente additiva) definita in `CLAUDE.md` per l'esistenza della tabella `player_stats` e `dataset_meta`.
*   **T2:** Cablaggio del `syncService.ts` per scaricare il payload, scriverlo in SQLite tramite Bulk Upsert e idratare il database.

---

## US 21: Dettaglio Calciatore (React Native UI)

**Come** fantallenatore
**Voglio** toccare la riga di un calciatore per aprire una scheda dettagliata con le sue metriche
**Affinché** io possa valutarne oggettivamente l'impatto e il rischio in base ai dati di livello 2 e 3.

### Criteri di Accettazione e Vincoli Architetturali:
1. **Navigazione:** Il tocco sul corpo di `PlayerRow` naviga verso `app/player/[id].tsx`. Il pulsante "+" laterale deve continuare ad aprire in modo indipendente il `CategorySheet`. Le due azioni restano separate.
2. **Gestione del Null in UI:** Se una metrica è `null`, l'interfaccia non deve mostrare "0" ma gestire lo stato vuoto (es. "Dato non disponibile").
3. **Data Fetching:** I dati non vengono estratti riga per riga nel listone (per preservare il framerate), ma caricati esplicitamente leggendo da `usePlayerStatsStore` o interrogando SQLite solo all'apertura del dettaglio.

### Task Tecnici:
*   **T1:** Estensione del componente `PlayerRow` per supportare la navigazione sul tocco del body.
*   **T2:** Creazione della schermata `app/player/[id].tsx` con layout a sezioni (Dati Economici, Rendimento, Metriche Analitiche).
*   **T3:** Implementazione del caricamento lazy dei dati e rendering condizionale per i campi `null`.