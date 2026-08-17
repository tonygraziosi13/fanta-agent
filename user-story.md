# EPIC 4: Sincronizzazione Dinamica e Analisi Avanzata

Questo documento definisce i requisiti per sostituire l'attuale importazione statica del CSV con un sistema dinamico e per espandere il modello dati, introducendo una vista di dettaglio arricchita da metriche statistiche e predittive.

---

## US 19: Generazione Dataset Arricchito (Data Pipeline Esterna)

**Come** sistema
**Voglio** aggregare i dati base, lo storico e le metriche avanzate dei calciatori in un unico file strutturato accessibile via cloud
**Affinché** l'applicazione mobile possa scaricare un pacchetto dati completo e normalizzato, senza demandare calcoli complessi al dispositivo dell'utente.

### Direttive e Criteri di Accettazione:
1. **Aggregazione Fonti:** Strutturare un processo esterno (es. script) in grado di raccogliere dati economici (quotazioni), dati storici (media voto, bonus/malus) e metriche avanzate (es. xG, xA, storico infortuni, dati tattici).
2. **Normalizzazione:** Il processo deve risolvere le discrepanze nei nomi dei calciatori provenienti da fonti diverse, utilizzando un identificativo univoco primario (es. ID della piattaforma ufficiale).
3. **Formato di Output:** Generare un file strutturato (preferibilmente JSON) che contenga per ogni giocatore tutti i dati organizzati gerarchicamente.
4. **Accessibilità:** Il file risultante, accompagnato da un indicatore di versione (es. timestamp o hash), deve essere ospitato su un URL pubblico per essere consumato dall'app.

### Task Tecnici (Backend/Scripting):
*   **T1: Modulo di Estrazione Dati:** Sviluppare le logiche per recuperare i dati dalle diverse fonti (scraping o API), mantenendo l'architettura modulare per facilitare futuri cambi di sorgente.
*   **T2: Risoluzione Entità:** Implementare un algoritmo di similarità o una mappa di associazione (mapping) per unire correttamente le statistiche avanzate al profilo base del giocatore corretto.
*   **T3: Esportazione e Hosting:** Definire il formato finale del payload e configurare un processo di rilascio automatico verso un servizio di hosting cloud (S3, GitHub Pages, Firebase, ecc.).

---

## US 20: Motore di Sincronizzazione Dati (Sync Engine)

**Come** fantallenatore
**Voglio** che l'applicazione verifichi e scarichi automaticamente le nuove statistiche e quotazioni all'avvio
**Affinché** il mio database sia sempre aggiornato senza richiedere l'installazione di nuove versioni dell'app.

### Direttive e Criteri di Accettazione:
1. **Controllo Versione:** All'apertura, l'app deve controllare l'URL remoto per determinare se i dati disponibili sono più recenti di quelli in memoria.
2. **Download Silente:** In caso di aggiornamento, l'app scarica il nuovo pacchetto. L'operazione deve gestire in modo aggraziato eventuali problemi di rete (timeout, offline) mantenendo i dati correnti.
3. **Integrità Relazionale:** L'aggiornamento del database locale (SQLite) deve aggiungere i nuovi giocatori e aggiornare quelli esistenti, *senza* sovrascrivere o corrompere le liste personali (Watchlist) create dall'utente.

### Task Tecnici (React Native / SQLite):
*   **T1: Estensione Schema Database:** Modificare la tabella locale corrente per accogliere i nuovi campi (metriche avanzate, indici tattici, flag di stato).
*   **T2: Hook di Avvio (Boot Check):** Implementare una logica all'avvio dell'app che confronti la versione locale del DB con quella remota. Prevedere una "early exit" (avvio immediato) se i dati sono già aggiornati.
*   **T3: Logica Bulk Upsert:** Scrivere la query e il modulo asincrono per parsare il nuovo dataset e aggiornare SQLite tramite un'operazione di inserimento/aggiornamento massivo, ottimizzando i tempi di scrittura.

---

## US 21: Visualizzazione Dettaglio e Metriche Avanzate

**Come** fantallenatore
**Voglio** accedere a una schermata di dettaglio per ogni singolo calciatore
**Affinché** io possa consultare e analizzare le sue metriche avanzate e il suo storico per supportare le mie decisioni in fase d'asta.

### Direttive e Criteri di Accettazione:
1. **Nuova Interazione:** Modificare il comportamento della lista principale (Listone e Watchlist): il tap sul giocatore deve aprire la nuova vista di dettaglio.
2. **Organizzazione Visiva:** La vista deve organizzare le informazioni in sezioni logiche e non dispersive (es. Dati Economici, Rendimento Storico, Metriche Analitiche).
3. **Supporto Visivo:** Ove pertinente, utilizzare componenti grafici (barre, indicatori colorati, o heatmap se fornite dal dataset) per rendere la lettura dei dati predittivi (es. rischio infortuni o xG) immediata.

### Task Tecnici (React Native / UI):
*   **T1: Configurazione Rotta/Modale:** Estendere il sistema di navigazione attuale (es. Expo Router o Bottom Sheet) per gestire una nuova schermata che riceve in input l'ID del giocatore.
*   **T2: Data Fetching Locale:** Implementare un selettore nello State Manager (Zustand) o una query diretta a SQLite per estrarre l'intero set di dati arricchiti del giocatore selezionato.
*   **T3: Sviluppo UI e Componenti Grafici:** Creare il layout della pagina di dettaglio. Sviluppare micro-componenti riutilizzabili per la visualizzazione grafica delle statistiche (es. indicatori di progressione, badge colorati).