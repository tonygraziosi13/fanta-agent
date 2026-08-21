import type { Opponent } from './opponent';
import type { Player } from './player';
import { CLASSIC_ROLES, type ClassicRole } from './roles';

/**
 * Allarme economico: i crediti bastano ancora per gli obiettivi in lista?
 *
 * --- La domanda giusta non e' "posso comprarli tutti" ---
 * Nessuno compra tutta la propria watchlist: ci si mettono venti nomi per
 * sceglierne otto. La domanda che conta e' un'altra: **con i crediti che mi
 * restano, riesco ancora a riempire le caselle vuote pescando dalla mia lista?**
 * Se la risposta e' no, o si abbassa la mira o si smette di rilanciare.
 *
 * Da qui il calcolo: per ogni ruolo si prendono i target piu' cari fino a
 * coprire gli slot liberi di quel ruolo — non tutti i target, solo quanti ce ne
 * stanno — e si somma quel che costerebbero.
 */

/**
 * Quanti acquisti servono prima di fidarsi dell'inflazione misurata.
 *
 * Con due o tre nomi il rapporto e' rumore: basta un portiere pagato uno per
 * far sembrare che la lega spenda meno del listino. Sotto questa soglia si
 * ripiega sulla quotazione nuda, dichiarandolo.
 */
export const CAMPIONE_MINIMO_INFLAZIONE = 5;

/**
 * Di quanto il tavolo paga sopra la quotazione, misurato su questa asta.
 *
 * --- Perche' non basta la quotazione ---
 * All'asta i giocatori vanno via sopra il listino, e di quanto dipende dalla
 * lega: fra un tavolo che tiene i prezzi e uno che spara, la differenza sul
 * fabbisogno totale e' di centinaia di crediti. Un allarme tarato sul listino
 * scatterebbe sempre troppo tardi.
 *
 * Il dato per misurarlo c'e' gia': i prezzi effettivamente pagati in *questa*
 * asta, che nessun listino potrebbe conoscere. Si sommano prezzi e quotazioni
 * dei giocatori gia' assegnati e si fa il rapporto.
 *
 * `null` finche' il campione e' troppo piccolo: meglio dire "sto usando la
 * quotazione" che dare un moltiplicatore inventato su tre acquisti.
 */
export function inflazioneOsservata(
  opponents: ReadonlyArray<Opponent>,
  playersById: Record<number, Player>
): number | null {
  let speso = 0;
  let listino = 0;
  let acquisti = 0;

  for (const opponent of opponents) {
    for (const pick of opponent.rosa) {
      const player = playersById[pick.playerId];
      // Un acquisto senza prezzo registrato non dice niente sull'inflazione:
      // contarlo come zero la farebbe sembrare piu' bassa di quel che e'.
      if (!player || pick.prezzo === null || player.qt_a <= 0) continue;
      speso += pick.prezzo;
      listino += player.qt_a;
      acquisti += 1;
    }
  }

  if (acquisti < CAMPIONE_MINIMO_INFLAZIONE || listino <= 0) return null;
  return speso / listino;
}

/** Quanto ci si aspetta di pagare quel giocatore, arrotondato per eccesso. */
export function costoAtteso(player: Player, inflazione: number | null): number {
  return Math.max(1, Math.ceil(player.qt_a * (inflazione ?? 1)));
}

export interface FabbisognoRuolo {
  ruolo: ClassicRole;
  slotLiberi: number;
  /** Target in lista per quel ruolo, ancora liberi. */
  disponibili: number;
  /** Quanto costerebbero i piu' cari, fino a coprire gli slot. */
  costo: number;
  /** true se i target in lista non bastano nemmeno a riempire il reparto. */
  scoperto: boolean;
}

export interface BudgetVerdict {
  /** Crediti necessari per riempire gli slot liberi coi target in lista. */
  fabbisogno: number;
  disponibile: number;
  /** Positivo = mancano crediti. */
  deficit: number;
  perRuolo: FabbisognoRuolo[];
  /** `null` = stima sulla quotazione nuda, campione ancora troppo piccolo. */
  inflazione: number | null;
}

/**
 * Confronta quel che servirebbe con quel che resta.
 *
 * `targets` sono i giocatori della watchlist **ancora liberi**: chi e' gia'
 * stato aggiudicato non e' piu' un obiettivo, e includerlo gonfierebbe il
 * fabbisogno con nomi irraggiungibili.
 */
export function valutaBudget(
  mia: Opponent,
  targets: ReadonlyArray<Player>,
  inflazione: number | null
): BudgetVerdict {
  const perRuolo: FabbisognoRuolo[] = CLASSIC_ROLES.map((ruolo) => {
    const slotLiberi = mia.slotLiberi[ruolo];
    const candidati = targets
      .filter((p) => p.r === ruolo)
      // Dal piu' caro: e' il caso peggiore, ed e' quello su cui vale la pena
      // avvisare. Partire dai piu' economici direbbe sempre che i crediti
      // bastano, fino al momento in cui non bastano piu'.
      .sort((a, b) => costoAtteso(b, inflazione) - costoAtteso(a, inflazione));

    const scelti = candidati.slice(0, slotLiberi);
    return {
      ruolo,
      slotLiberi,
      disponibili: candidati.length,
      costo: scelti.reduce((somma, p) => somma + costoAtteso(p, inflazione), 0),
      scoperto: candidati.length < slotLiberi,
    };
  });

  const fabbisogno = perRuolo.reduce((somma, r) => somma + r.costo, 0);

  return {
    fabbisogno,
    disponibile: mia.creditiResidui,
    deficit: Math.max(fabbisogno - mia.creditiResidui, 0),
    perRuolo,
    inflazione,
  };
}

export interface Alternativa {
  /** Il target che non ci si puo' piu' permettere. */
  target: Player;
  /** Chi rende di piu' entro il tetto di spesa. */
  sostituti: Player[];
}

/**
 * Alternative piu' economiche a un obiettivo diventato troppo caro.
 *
 * --- Come si misura "simile" ---
 * Col **FantaValore di Mercato**, non con le statistiche avanzate. Sembra la
 * scelta povera e non lo e': il FVM e' la stima che il mercato stesso da' del
 * rendimento atteso di un giocatore, sta gia' in memoria su ogni riga del
 * listone, e non costa una query per candidato — mentre cercare fra cinquecento
 * svincolati incrociando xG e fantamedia significherebbe cinquecento letture da
 * SQLite nel momento peggiore, cioe' mentre il banditore conta.
 *
 * Non si cercano pero' FVM *simili*: FVM e quotazione vanno di pari passo, e
 * "stesso valore, molto meno caro" e' quasi sempre un insieme vuoto. Si cerca il
 * **massimo rendimento entro il tetto di spesa**, che e' la domanda vera: "se
 * non arrivo a Bastoni, chi e' il meglio che posso ancora prendermi?".
 */
export function alternativeEntroIlTetto(
  target: Player,
  liberi: ReadonlyArray<Player>,
  tetto: number,
  inflazione: number | null,
  quante = 3
): Player[] {
  return liberi
    .filter(
      (p) =>
        p.r === target.r &&
        p.id !== target.id &&
        costoAtteso(p, inflazione) <= tetto &&
        // Un sostituto che vale meno della meta' non e' un'alternativa, e'
        // un ripiego: proporlo farebbe sembrare risolto un problema che resta.
        p.fvm >= target.fvm * 0.5
    )
    .sort((a, b) => b.fvm - a.fvm || a.qt_a - b.qt_a)
    .slice(0, quante);
}

/**
 * I target fuori portata, con le rispettive alternative.
 *
 * Il tetto e' il budget medio per slot: e' la cifra che si puo' spendere su
 * ciascuno senza restare a secco prima di aver riempito la rosa.
 */
export function proponiAlternative(
  verdict: BudgetVerdict,
  mia: Opponent,
  targets: ReadonlyArray<Player>,
  liberi: ReadonlyArray<Player>,
  quanti = 3
): Alternativa[] {
  const slot = verdict.perRuolo.reduce((somma, r) => somma + r.slotLiberi, 0);
  if (slot <= 0) return [];

  const tetto = Math.floor(mia.creditiResidui / slot);

  return targets
    .filter((p) => costoAtteso(p, verdict.inflazione) > tetto)
    .sort((a, b) => costoAtteso(b, verdict.inflazione) - costoAtteso(a, verdict.inflazione))
    .slice(0, quanti)
    .map((target) => ({
      target,
      sostituti: alternativeEntroIlTetto(target, liberi, tetto, verdict.inflazione),
    }));
}
