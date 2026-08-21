import { inflazioneOsservata } from '@/domain/budgetAlert';
import { STRATEGIA_LABELS, proponiRiempimento } from '@/domain/watchlistFill';
import { selectSvincolati } from '@/state/auctionSelectors';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';
import type { AgentTool } from '../types';

interface Input {
  /** Solo questa categoria. Omesso = tutte quelle ancora vuote. */
  categoria?: string;
  /** Quanti nomi per categoria. Default 5. */
  quanti?: number;
}

/**
 * Suggerimenti per riempire la watchlist.
 *
 * --- Perche' e' di sola lettura ---
 * Restituisce delle proposte e non le assegna: per aggiungere c'e' gia'
 * `assign_player`, che passa dalla pipeline. Tenere separate la proposta e la
 * scrittura fa si' che il modello debba dire *cosa* aggiunge, riga per riga,
 * invece di riempire cinque categorie con un colpo solo che nessuno ha letto.
 *
 * --- Le fasce, non i nomi ---
 * Il valore per il modello non e' l'elenco ma la **fascia di prezzo** che ogni
 * categoria implica dato il budget residuo: e' l'informazione che gli permette
 * di rispondere "per le scommesse cerca sotto i 6 crediti" invece di ripetere
 * cinque nomi che l'utente ha gia' davanti.
 */
export const suggestWatchlistTool: AgentTool<Input> = {
  name: 'suggest_watchlist',
  description:
    'Propone giocatori svincolati per le categorie ancora vuote della watchlist, ' +
    'partendo dal budget medio per slot rimanente: ogni categoria ha una strategia ' +
    '(punta, equilibrio, scommessa) e quindi una fascia di prezzo. Non aggiunge ' +
    'niente: per assegnare usa assign_player.',
  input_schema: {
    type: 'object',
    properties: {
      categoria: {
        type: 'string',
        description: 'Nome della categoria da riempire. Omesso = tutte quelle vuote.',
      },
      quanti: { type: 'number', description: 'Quanti nomi per categoria (default 5).' },
    },
  },
  handler: async ({ categoria, quanti = 5 } = {}) => {
    const players = usePlayersStore.getState().players;
    const playersById = usePlayersStore.getState().byId;
    const opponents = useOpponentsStore.getState().items;
    const assignments = useWatchlistStore.getState().assignments;
    const categorie = useCategoriesStore.getState().categories;

    const mia = opponents.find((o) => o.isMe);
    if (!mia) {
      return {
        errore:
          'Non e ancora stata importata la lega: senza la squadra dell utente non ' +
          'si conosce il budget residuo su cui tarare le fasce.',
      };
    }

    const assegnati = new Set(Object.keys(assignments).map(Number));
    const bersagli = categoria
      ? categorie.filter((c) => c.name.toLowerCase() === categoria.toLowerCase())
      // Solo le vuote: su una lista gia' scritta il suggerimento e' un consiglio
      // non richiesto sopra un lavoro che l'utente ha gia' fatto.
      : categorie.filter((c) => !Object.values(assignments).includes(c.id));

    if (bersagli.length === 0) {
      return {
        categorie: [],
        nota: categoria
          ? `Nessuna categoria si chiama "${categoria}".`
          : 'Tutte le categorie hanno gia almeno un giocatore.',
      };
    }

    const proposte = proponiRiempimento(
      bersagli,
      selectSvincolati(players, opponents),
      mia,
      assegnati,
      { quanti, inflazione: inflazioneOsservata(opponents, playersById) }
    );

    return {
      crediti_residui: mia.creditiResidui,
      categorie: proposte.map((p) => ({
        categoria: p.categoria.name,
        strategia: p.fascia.strategia,
        criterio: STRATEGIA_LABELS[p.fascia.strategia],
        fascia: { min: p.fascia.min, max: p.fascia.max },
        motivo: p.motivo ?? null,
        giocatori: p.giocatori.map((g) => ({
          id: g.id,
          nome: g.nome,
          ruolo: g.r,
          squadra: g.squadra,
          quotazione: g.qt_a,
          fvm: g.fvm,
        })),
      })),
    };
  },
};
