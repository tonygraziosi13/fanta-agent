import { saveOpponentState } from '@/core/repositories/opponentsRepository';
import { offertaMassima } from '@/domain/opponent';
import { isClassicRole, type ClassicRole } from '@/domain/roles';
import { presiDaQualcuno } from '@/state/auctionSelectors';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { createPipeline, type DispatchResult, type Stage } from '../pipeline';

/**
 * Motore di Transazione: registra un'aggiudicazione all'asta.
 *
 * E' la **Fase 1** del middleware agentico — l'ispezione che interviene prima
 * che il ciclo decisionale cominci. Non serviva un sistema nuovo: `validate ->
 * reduce -> effect` e' gia' la "configurazione sequenziale fissa" descritta, e
 * il commento di `pipeline.ts` prevedeva da subito che un'azione dell'agente
 * l'avrebbe percorsa. Un secondo middleware con lo stesso vocabolario avrebbe
 * solo dato due sistemi da tenere allineati a mano.
 *
 * Conseguenza gratuita: un'aggiudicazione registrata dall'utente e una decisa
 * dall'agente sono la stessa operazione, come gia' accade per la watchlist.
 */

export type PickAction =
  | {
      type: 'assegna';
      playerId: number;
      /** Prezzo di aggiudicazione, in crediti. */
      costo: number;
      /** Chi se l'e' aggiudicato: un id di `opponents`, non un nome. */
      opponentId: number;
      ruolo: ClassicRole;
    }
  | { type: 'annulla'; playerId: number; opponentId: number; ruolo: ClassicRole };

/**
 * Stadio unico, come in `assignmentHook`: la sequenza *e'* la separazione delle
 * responsabilita'. Spezzarla in piu' stadi aggiungerebbe indirezione senza
 * separare niente di reale.
 */
const pickStage: Stage<PickAction> = {
  name: 'auction-pick',

  // --- Fase 1: validazione statica, tutta su indici in RAM. Nessun I/O, quindi
  // il rifiuto e' immediato e l'utente lo vede nello stesso frame del tocco.
  validate: (action) => {
    const opponents = useOpponentsStore.getState().items;

    // --- Annullamento: le regole sono altre, e sono poche.
    // Non si controlla il costo ne' lo slot: si sta restituendo, non spendendo.
    if (action.type === 'annulla') {
      const opponent = opponents.find((o) => o.id === action.opponentId);
      if (!opponent) return `Partecipante ${action.opponentId} inesistente.`;
      if (!opponent.rosa.some((r) => r.playerId === action.playerId)) {
        return `Quel giocatore non risulta nella rosa di ${opponent.nome}.`;
      }
      return true;
    }

    if (!Number.isFinite(action.costo) || action.costo < 0) {
      return 'Il costo deve essere un numero non negativo.';
    }
    if (!isClassicRole(action.ruolo)) {
      return `Ruolo "${action.ruolo}" non valido.`;
    }

    const player = usePlayersStore.getState().byId[action.playerId];
    if (!player) return `Giocatore ${action.playerId} inesistente.`;
    // Il ruolo passato deve essere quello vero: sbagliarlo scalerebbe lo slot
    // di un reparto e lascerebbe l'altro pieno, con un errore che si scopre
    // solo a rosa completa.
    if (player.r !== action.ruolo) {
      return `${player.nome} e' un ${player.r}, non un ${action.ruolo}.`;
    }

    const opponent = opponents.find((o) => o.id === action.opponentId);
    if (!opponent) return `Partecipante ${action.opponentId} inesistente.`;

    // Gia' di qualcun altro: in asta capita di registrare due volte lo stesso
    // nome, e senza questo controllo il giocatore finirebbe in due rose.
    if (presiDaQualcuno(opponents).has(action.playerId)) {
      return `${player.nome} e' gia' stato aggiudicato.`;
    }

    if (opponent.slotLiberi[action.ruolo] <= 0) {
      return `${opponent.nome} ha gia' completato il reparto ${action.ruolo}.`;
    }

    // --- Il vincolo che conta, e non e' "ha abbastanza crediti" ---
    // `offertaMassima` tiene un credito per ogni slot ancora vuoto: con 100
    // crediti e 10 posti da riempire il massimo su un singolo giocatore e' 91,
    // perche' gli altri nove vanno comunque coperti. Riusarla qui — invece di
    // confrontare col totale — significa che UI, validazione e agente applicano
    // la stessa regola, definita in un posto solo.
    const massimo = offertaMassima(opponent);
    if (action.costo > massimo) {
      return `${opponent.nome} puo' offrire al massimo ${massimo} crediti (ne ha ${opponent.creditiResidui}, con ${slotTotali(opponent.slotLiberi)} slot da riempire).`;
    }

    return true;
  },

  // --- Stato in memoria: sincrono. Crediti e slot scalano subito, la lista
  // degli svincolati si ricalcola da se' perche' e' derivata.
  reduce: (action) => {
    const store = useOpponentsStore.getState();
    if (action.type === 'annulla') {
      store.undoPickLocal(action.opponentId, action.playerId, action.ruolo);
    } else {
      store.applyPickLocal(action.opponentId, action.playerId, action.costo, action.ruolo);
    }
  },

  // --- Persistenza: in background, la UI non l'attende.
  effect: async (action) => {
    // Si rilegge dallo store *dopo* il reduce: e' quello lo stato corretto, e
    // `saveOpponentState` scrive la riga intera. Ricalcolare qui i valori dai
    // campi dell'azione significherebbe avere due volte la stessa aritmetica,
    // con la seconda copia libera di divergere.
    const opponent = useOpponentsStore
      .getState()
      .items.find((o) => o.id === action.opponentId);
    if (!opponent) return;

    await saveOpponentState(opponent);
  },
};

function slotTotali(slot: Record<ClassicRole, number>): number {
  return slot.P + slot.D + slot.C + slot.A;
}

export const auctionPipeline = createPipeline<PickAction>([pickStage]);

/** API applicativa. UI e agente chiamano queste, mai il repository. */

/**
 * Registra un'aggiudicazione.
 *
 * Restituisce l'esito invece di sollevare, ed e' la forma che serve sia alla UI
 * (che deve mostrare il motivo del rifiuto) sia all'agente: `executeTool` ha la
 * regola esplicita di non sollevare mai, perche' un errore restituito come dato
 * permette al modello di correggersi al turno successivo.
 */
export function registraAcquisto(
  playerId: number,
  costo: number,
  opponentId: number,
  ruolo: ClassicRole
): DispatchResult {
  return auctionPipeline.dispatch({ type: 'assegna', playerId, costo, opponentId, ruolo });
}

/**
 * Annulla un'aggiudicazione: restituisce crediti e slot.
 *
 * In asta un tocco sbagliato e' comune — un nome simile, una cifra digitata di
 * fretta — e senza un modo di tornare indietro l'unico rimedio sarebbe
 * reimportare lo stato, perdendo tutto il resto della sessione. Il prezzo
 * restituito e' quello **registrato**, non uno passato da fuori: e' l'unico che
 * sappiamo essere stato scalato davvero.
 */
export function annullaAcquisto(
  playerId: number,
  opponentId: number,
  ruolo: ClassicRole
): DispatchResult {
  return auctionPipeline.dispatch({ type: 'annulla', playerId, opponentId, ruolo });
}

/**
 * Come sopra, ma solleva su transazione non valida.
 *
 * La specifica del motore chiedeva un'eccezione bloccante; la pipeline non
 * solleva per contratto. Invece di piegare uno dei due, la semantica bloccante
 * e' un involucro di tre righe — e chi la vuole la chiede esplicitamente.
 */
export async function registraAcquistoOrThrow(
  playerId: number,
  costo: number,
  opponentId: number,
  ruolo: ClassicRole
): Promise<void> {
  const result = registraAcquisto(playerId, costo, opponentId, ruolo);
  if (!result.ok) {
    throw new TransazioneRifiutata(result.reason ?? 'Transazione non valida.');
  }
  await result.persisted;
}

export class TransazioneRifiutata extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransazioneRifiutata';
  }
}
