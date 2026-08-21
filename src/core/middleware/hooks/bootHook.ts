import { runMigrations } from '@/core/db/migrations';
import { readDevSeed } from '@/core/parsing/statoAstaSeed';
import { countOpponents } from '@/core/repositories/opponentsRepository';
import { countPlayers } from '@/core/repositories/playersRepository';
import { syncFromBundle, syncFromRemote } from '@/core/sync/syncService';
import type { SyncOutcome } from '@/core/sync/syncEngine';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import { usePlayerStatsStore } from '@/state/usePlayerStatsStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useSyncStore } from '@/state/useSyncStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';

/**
 * Hook di inizializzazione (US7-T4).
 *
 * Nodo sequenziale fisso per eccellenza: gira immediatamente prima che la UI
 * sia navigabile, e decide se sbloccarla o trattenere lo splash.
 *
 *   DB vuoto  -> interruzione precoce della navigazione: si scarica il dataset
 *                remoto (US20) e, se la rete non c'e', si ricade sul CSV
 *                incluso. Sblocco solo a scrittura completata.
 *   DB pieno  -> validazione istantanea, accesso immediato, sync in background.
 *
 * --- La policy di rete (US20-1, US20-2) ---
 * Il controllo di versione all'avvio non giustifica un'attesa all'avvio. A
 * freddo non c'e' scelta — senza dati non c'e' niente da mostrare — ma dal
 * secondo lancio in poi l'app parte con i dati che ha gia' e l'aggiornamento
 * viaggia dietro le quinte: se arriva, gli store si ri-idratano; se non arriva,
 * l'utente non se ne accorge nemmeno. Bloccare l'avvio su una richiesta HTTP
 * significherebbe legare il tempo di apertura dell'app alla qualita' del campo.
 *
 * Non e' un componente React di proposito: e' invocabile anche da un test o,
 * in futuro, dall'agente che volesse forzare un re-import.
 */

export type BootPhase =
  | 'idle'
  | 'migrating'
  | 'importing'
  | 'hydrating'
  | 'ready'
  | 'error';

export interface BootResult {
  phase: BootPhase;
  imported: number;
  /** true se il listone e' stato importato in questo avvio (primo lancio). */
  coldStart: boolean;
  error?: string;
}

export interface BootCallbacks {
  onPhase?: (phase: BootPhase) => void;
}

/**
 * Primo avvio: si tenta il dataset remoto e si ripiega sul CSV incluso.
 *
 * L'ordine e' quello e non l'inverso: partire dal bundle sarebbe piu' veloce ma
 * lascerebbe l'utente con dati potenzialmente vecchi di mesi proprio nel momento
 * in cui non ha ancora nulla e sta guardando lo splash. Il fallback vale la pena
 * solo quando il primo tentativo non e' andato.
 *
 * Se anche il bundle fallisce si solleva: senza listone non c'e' app, ed e' il
 * solo caso in cui il boot deve mostrare una schermata d'errore.
 */
async function coldStartImport(): Promise<number> {
  const sync = useSyncStore.getState();

  const remote = await syncFromRemote(sync.setPhase);
  if (remote.status === 'updated') {
    sync.complete(remote);
    return remote.players;
  }

  const bundled = await syncFromBundle(sync.setPhase);
  if (bundled.status === 'updated') {
    // L'esito che conta per l'utente e' il fallimento remoto: e' il motivo per
    // cui sta guardando quotazioni senza statistiche.
    sync.complete(remote.status === 'failed' ? remote : bundled);
    return bundled.players;
  }

  throw new Error(
    describeFailure(bundled) ??
      'Impossibile inizializzare il listone: nessuna sorgente disponibile.'
  );
}

/**
 * Avvio caldo: controllo di versione senza attese per l'utente.
 *
 * Se il dataset cambia davvero, gli store vengono ri-idratati a scrittura
 * conclusa. E' l'unico punto in cui il listone in RAM viene ricaricato dopo il
 * boot, ed e' sicuro: `usePlayersStore.load()` sostituisce l'array, e le righe
 * si ridisegnano da sole. La watchlist non viene toccata — le assegnazioni
 * dell'utente non dipendono dal dataset (US20-3).
 */
async function backgroundSync(): Promise<void> {
  const sync = useSyncStore.getState();
  const outcome = await syncFromRemote(sync.setPhase);
  sync.complete(outcome);

  if (outcome.status === 'updated') {
    // L'ordine conta poco, la coppia molto: la cache delle metriche in RAM si
    // riferisce alla versione precedente del dataset e va buttata, altrimenti
    // un giocatore gia' aperto continuerebbe a mostrare i numeri vecchi finche'
    // l'app non viene chiusa.
    usePlayerStatsStore.getState().clear();
    await usePlayersStore.getState().load();
  }
}

function describeFailure(outcome: SyncOutcome): string | null {
  return outcome.status === 'failed' ? outcome.error : null;
}

/**
 * Semina lo stato d'asta in sviluppo, se non c'e' gia'.
 *
 * `stato_asta.json` e' gitignorato e non ha modo di raggiungere il dispositivo
 * da solo (vedi `statoAstaSeed.ts`). Questo nodo lo importa una volta al primo
 * avvio dopo averlo generato, cosi' la catena si puo' collaudare sul telefono
 * senza incollare due chilobyte in una console.
 *
 * Tre guardie, e ognuna evita un danno diverso:
 *
 *   `__DEV__`          in produzione sarebbe un dato personale dentro l'app.
 *   nessun avversario  non si sovrascrive **mai** un'asta gia' impostata: i
 *                      crediti scalati durante una sessione valgono piu' di un
 *                      seme che li riporterebbe tutti a 500.
 *   configurazione     gli avversari appartengono a una lega; senza `config_id`
 *                      non avrebbero dove stare.
 *
 * Non solleva mai: seminare e' una comodita' di sviluppo, e un seme malformato
 * non deve impedire di aprire l'app.
 */
async function seedOpponentsInDev(configId: number | null): Promise<void> {
  if (!__DEV__ || configId === null) return;

  try {
    if ((await countOpponents(configId)) > 0) return;

    const raw = readDevSeed();
    if (raw === null) return;

    const esito = await useOpponentsStore.getState().importSeed(raw, configId);
    if (esito.ok) {
      console.log(
        `[asta] seme importato: ${esito.imported} squadre` +
          (esito.skipped > 0 ? `, ${esito.skipped} scartate` : '')
      );
    } else {
      console.warn(`[asta] seme non importato: ${esito.error}`);
    }
  } catch (error) {
    console.warn('[asta] import del seme fallito:', error);
  }
}

export async function runBootSequence(callbacks: BootCallbacks = {}): Promise<BootResult> {
  const { onPhase } = callbacks;
  const report = (phase: BootPhase) => onPhase?.(phase);

  try {
    // --- Nodo 1: schema. Idempotente, costa un PRAGMA dal secondo avvio.
    report('migrating');
    await runMigrations();

    // --- Nodo 2: il listone c'e' gia'? Verifica statica che decide il ramo.
    const existing = await countPlayers();
    const coldStart = existing === 0;
    let imported = 0;

    if (coldStart) {
      // --- Nodo 3 (solo primo avvio): import bloccante. La UI resta ferma qui.
      report('importing');
      imported = await coldStartImport();
    }

    // --- Nodo 4: idratazione degli store. In parallelo: sono letture
    // indipendenti, serializzarle allungherebbe lo splash senza motivo.
    report('hydrating');
    await Promise.all([
      usePlayersStore.getState().load(),
      useCategoriesStore.getState().load(),
      useConfigurationsStore.getState().load(),
    ]);

    // La watchlist e' l'unica lettura dipendente: sapere quali assegnazioni
    // caricare richiede prima di sapere qual e' la configurazione attiva.
    // Con `null` (primo avvio, nessuna configurazione) resta semplicemente vuota
    // e la UI mostrera' il wizard iniziale.
    const activeId = useConfigurationsStore.getState().activeId;
    await useWatchlistStore.getState().load(activeId);

    // --- Nodo 4b: gli avversari dell'asta attiva.
    // Atteso, a differenza del sync: sono nove righe, e l'agente non deve
    // poterle trovare a meta' se qualcuno gli chiede qualcosa subito.
    await seedOpponentsInDev(activeId);
    if (activeId !== null) {
      await useOpponentsStore.getState().load(activeId);
    }

    // --- Nodo 5: aggiornamento in background (solo ad avvio caldo).
    // Deliberatamente NON atteso, come gli `effect` della pipeline: la UI e'
    // gia' pronta e il framerate non deve dipendere dalla latenza di rete.
    if (!coldStart) {
      void backgroundSync();
    }

    report('ready');
    return { phase: 'ready', imported, coldStart };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report('error');
    return { phase: 'error', imported: 0, coldStart: false, error: message };
  }
}
