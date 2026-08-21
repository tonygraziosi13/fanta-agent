import { costoAtteso } from './budgetAlert';
import type { Category } from './category';
import type { Opponent } from './opponent';
import type { Player } from './player';
import { CLASSIC_ROLES, type ClassicRole } from './roles';

/**
 * Riempimento automatico della watchlist.
 *
 * L'utente crea le etichette — "Must-Have", "Scommesse" — e questo modulo
 * propone chi metterci dentro, partendo dal **budget medio per slot rimanente**:
 * con 300 crediti e venti caselle vuote si ragiona su quindici a testa, e un
 * "must-have" da ottanta e una "scommessa" da tre stanno su due scale diverse
 * della stessa cifra.
 *
 * --- Proporre, non aggiungere ---
 * Le proposte non entrano da sole: la watchlist e' un documento di strategia
 * scritto dall'utente, e riempirlo senza chiedere sarebbe la cosa piu' veloce
 * per fargli smettere di fidarsi. Si suggerisce, e ogni riga si accetta col
 * solito tocco — che passa dalla stessa `assignPlayer` del Listone.
 *
 * --- Quel che qui non c'e', e perche' ---
 * Un LLM servirebbe a **interpretare nomi di categoria arbitrari**: capire che
 * "Titolari da 6 in pagella" chiede continuita' e non bonus e' un lavoro di
 * lingua. Le quattro categorie predefinite hanno invece una strategia esplicita
 * scritta qui sotto, e per i nomi inventati dall'utente si usa un criterio
 * neutro dichiarato. Meglio un comportamento prevedibile che indovinare.
 */

/** Le strategie che sappiamo applicare senza interpretare la lingua. */
export type Strategia = 'punta' | 'equilibrio' | 'scommessa' | 'nessuna';

export interface Fascia {
  /** Costo atteso minimo, in crediti. */
  min: number;
  max: number;
  strategia: Strategia;
}

/** Sotto questa cifra per slot non c'e' spazio per differenziare le fasce. */
const BUDGET_MINIMO = 3;

/**
 * La strategia che corrisponde al nome di una categoria.
 *
 * Riconosce le quattro predefinite per parola chiave e non per uguaglianza
 * esatta: l'utente puo' rinominare "Scommesse" in "Scommesse low cost" senza
 * che il riconoscimento si rompa.
 *
 * **"Da evitare" non si riempie mai.** E' una lista negativa: popolarla
 * automaticamente vorrebbe dire suggerire all'utente di scartare giocatori che
 * non ha mai valutato — l'esatto contrario di quel che quella categoria serve a
 * ricordare.
 */
export function strategiaPerCategoria(nome: string): Strategia {
  const n = nome.toLowerCase();
  if (n.includes('evitare') || n.includes('no ') || n.startsWith('mai')) return 'nessuna';
  if (n.includes('must') || n.includes('top') || n.includes('big')) return 'punta';
  if (n.includes('scommess') || n.includes('low') || n.includes('gemme')) return 'scommessa';
  return 'equilibrio';
}

/**
 * La fascia di prezzo di una strategia, a partire dal budget per slot.
 *
 * I moltiplicatori dicono come si spende, non quanto: su un "must-have" si
 * concentra la spesa e si accetta di pagare piu' volte la media, su una
 * scommessa si sta sotto per poterne prendere tante.
 */
export function fasciaPer(strategia: Strategia, budgetPerSlot: number): Fascia {
  const b = Math.max(budgetPerSlot, BUDGET_MINIMO);

  switch (strategia) {
    case 'punta':
      // Fino a cinque volte la media: e' la concentrazione che rende un
      // must-have tale, ed e' anche il motivo per cui ne entrano pochi.
      return { min: Math.ceil(b * 1.5), max: Math.ceil(b * 5), strategia };
    case 'equilibrio':
      return { min: Math.max(Math.floor(b * 0.6), 1), max: Math.ceil(b * 1.5), strategia };
    case 'scommessa':
      // Dal minimo assoluto fino a meta' media: sotto quella soglia un errore
      // costa poco, ed e' esattamente il senso di scommettere.
      return { min: 1, max: Math.max(Math.ceil(b * 0.5), 2), strategia };
    case 'nessuna':
      return { min: 0, max: 0, strategia };
  }
}

export interface Proposta {
  categoria: Category;
  fascia: Fascia;
  giocatori: Player[];
  /** Perche' non c'e' niente da proporre, quando l'elenco e' vuoto. */
  motivo?: string;
}

interface Opzioni {
  /** Quanti nomi per categoria. */
  quanti?: number;
  inflazione?: number | null;
}

/**
 * Proposte per ogni categoria, escluse quelle gia' popolate.
 *
 * `assegnati` sono i giocatori gia' in watchlist, in qualunque categoria:
 * riproporre un nome che l'utente ha gia' scelto lo farebbe dubitare di aver
 * capito come funziona la lista.
 */
export function proponiRiempimento(
  categorie: ReadonlyArray<Category>,
  liberi: ReadonlyArray<Player>,
  mia: Opponent,
  assegnati: ReadonlySet<number>,
  { quanti = 5, inflazione = null }: Opzioni = {}
): Proposta[] {
  const slotTotali = CLASSIC_ROLES.reduce((somma, r) => somma + mia.slotLiberi[r], 0);
  const budgetPerSlot = slotTotali > 0 ? mia.creditiResidui / slotTotali : 0;

  // Solo i ruoli che hanno ancora posto: suggerire cinque attaccanti a chi ha
  // il reparto pieno e cerca un portiere e' un consiglio che fa perdere tempo.
  const ruoliUtili = CLASSIC_ROLES.filter((r) => mia.slotLiberi[r] > 0);

  const candidati = liberi.filter((p) => !assegnati.has(p.id) && ruoliUtili.includes(p.r));

  return categorie.map((categoria) => {
    const strategia = strategiaPerCategoria(categoria.name);
    const fascia = fasciaPer(strategia, budgetPerSlot);

    if (strategia === 'nessuna') {
      return {
        categoria,
        fascia,
        giocatori: [],
        motivo:
          'È una lista di esclusione: riempirla in automatico significherebbe scartare giocatori mai valutati.',
      };
    }

    if (slotTotali === 0) {
      return { categoria, fascia, giocatori: [], motivo: 'La tua rosa è completa.' };
    }

    const inFascia = candidati.filter((p) => {
      const costo = costoAtteso(p, inflazione);
      return costo >= fascia.min && costo <= fascia.max;
    });

    if (inFascia.length === 0) {
      return {
        categoria,
        fascia,
        giocatori: [],
        motivo: `Nessuno svincolato fra ${fascia.min} e ${fascia.max} crediti nei ruoli che ti restano.`,
      };
    }

    return {
      categoria,
      fascia,
      giocatori: ordinaPer(strategia, inFascia, inflazione).slice(0, quanti),
    };
  });
}

/**
 * L'ordine dipende dalla strategia, e la differenza non e' cosmetica.
 *
 * Su una punta conta il **rendimento assoluto**: si paga per avere il migliore.
 * Su una scommessa conta il **rendimento per credito**: si cerca chi il mercato
 * ha valutato poco, e a parita' di rapporto vince chi costa meno, perche' a
 * quel punto si tratta di quante se ne possono tentare.
 */
function ordinaPer(
  strategia: Strategia,
  players: Player[],
  inflazione: number | null
): Player[] {
  if (strategia === 'scommessa') {
    return [...players].sort(
      (a, b) => valorePerCredito(b, inflazione) - valorePerCredito(a, inflazione) || a.qt_a - b.qt_a
    );
  }
  // `id` come spareggio: senza, due giocatori a pari FVM cambierebbero posto fra
  // una chiamata e l'altra, e una lista che si riordina da sola non si legge.
  return [...players].sort((a, b) => b.fvm - a.fvm || a.id - b.id);
}

/** Quanto rende ogni credito speso, secondo la stima di mercato. */
export function valorePerCredito(player: Player, inflazione: number | null): number {
  return player.fvm / costoAtteso(player, inflazione);
}

/** Etichetta leggibile della strategia, per la schermata. */
export const STRATEGIA_LABELS: Record<Strategia, string> = {
  punta: 'i più forti che puoi permetterti',
  equilibrio: 'solidi, attorno alla tua media per slot',
  scommessa: 'poco costosi, molto valore per credito',
  nessuna: 'nessun suggerimento',
};
