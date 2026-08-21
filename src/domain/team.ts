/**
 * Il profilo tattico di una squadra di Serie A.
 *
 * Viene da `dataset/coaches.json`, generato da `npm run coaches`. Serve a
 * rispondere a domande che i dati del singolo giocatore non bastano a chiudere:
 * un difensore vale da modificatore anche per *chi ha davanti e dietro*, e un
 * esterno vale il doppio in un 3-5-2 rispetto a un 4-3-3.
 */

/** Giornate di un campionato a 20 squadre: il denominatore dei valori per-90. */
export const PARTITE_STAGIONE = 38;

export interface Team {
  /** Nome come lo scrive il listone: `Milan`, non `AC Milan`. */
  nome: string;
  allenatore: string | null;
  /** Es. "3-5-2". `null` per un allenatore appena arrivato. */
  moduloBase: string | null;

  xgTotali: number | null;
  xgaTotali: number | null;
  /**
   * Passaggi concessi per azione difensiva.
   *
   * **Basso = pressing aggressivo.** Il verso contro-intuitivo è la ragione per
   * cui questo campo ha un commento: un valore piccolo è una squadra che
   * aggredisce alto, e per un difensore significa più falli tattici e più
   * cartellini — un malus, non un pregio.
   */
  ppdaStagione: number | null;

  giocatoriImpiegati: number | null;
  gialliTotali: number | null;
  rossiTotali: number | null;
  distribuzioneGol: GoalSplit | null;
}

export interface GoalSplit {
  difensori: number;
  centrocampisti: number;
  attaccanti: number;
  totale: number;
  difensoriPerc: number;
  centrocampistiPerc: number;
  attaccantiPerc: number;
}

/**
 * Gol attesi subiti per 90 minuti.
 *
 * Per una *classifica* dividere per 38 non cambia niente — tutte le squadre
 * giocano lo stesso numero di partite, quindi l'ordinamento è identico a quello
 * dei totali. Si calcola per onestà dell'etichetta: "xGA 51.7" e "xGA/90 1.36"
 * sono lo stesso fatto, ma solo il secondo si confronta con i numeri che un
 * fantallenatore ha in testa.
 */
export function xgaPer90(team: Team): number | null {
  if (team.xgaTotali === null) return null;
  return team.xgaTotali / PARTITE_STAGIONE;
}

export function xgPer90(team: Team): number | null {
  if (team.xgTotali === null) return null;
  return team.xgTotali / PARTITE_STAGIONE;
}

/**
 * Quanti difensori schiera il modulo: il primo numero di "3-5-2".
 *
 * `null` quando il modulo manca o non è leggibile. Serve al "System Fit": un
 * esterno listato D rende molto di più in una difesa a tre, dove gioca da
 * quinto e attacca, che in una a quattro.
 */
export function difensoriNelModulo(team: Team): number | null {
  if (team.moduloBase === null) return null;
  const primo = /^(\d)/.exec(team.moduloBase);
  return primo ? Number(primo[1]) : null;
}
