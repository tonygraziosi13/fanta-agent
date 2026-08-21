import type { AdvancedMetrics, SeasonPerformance } from './playerStats';
import type { Team } from './team';

/**
 * Indice Modificatore: quanto vale un difensore per il modificatore di difesa.
 *
 * --- Perche' non basta la media voto ---
 * La media voto di un difensore e' quasi piatta: fra il migliore e il peggiore
 * della Serie A ballano tre decimi, e su quella scala non si costruisce un'asta.
 * Quel che distingue davvero un difensore da modificatore sta altrove: la
 * squadra in cui gioca (chi subisce meno prende voti piu' alti per tutta la
 * linea), quanto partecipa alla manovra (i pagellisti premiano l'impostazione),
 * quanti bonus puo' produrre, e quanti malus si porta dietro.
 *
 * Vive nel dominio come `metrics.ts` e `roles.ts`: "questo difensore vale da
 * modificatore" e' un giudizio, e deve dire la stessa cosa alla UI, all'agente
 * e a un futuro confronto fra due giocatori.
 *
 * --- Le due scelte che decidono il risultato ---
 *
 * 1. **Percentili, non valori assoluti.** 0.8 di xGBuildup e 45 di xGA non
 *    stanno sullo stesso righello: pesarli direttamente vorrebbe dire inventare
 *    costanti di conversione, e ogni taratura successiva le renderebbe bugiarde.
 *    Ogni componente diventa il rango del giocatore *dentro l'insieme dei
 *    candidati*, quindi un numero fra 0 e 1 confrontabile con gli altri.
 *
 * 2. **Un dato mancante ridistribuisce il peso, non vale zero.** Un difensore
 *    senza xGBuildup non e' "pessimo in impostazione": e' un difensore di cui
 *    non lo sappiamo. Azzerarlo lo manderebbe in fondo alla classifica per un
 *    buco di copertura, che e' il modo piu' silenzioso di dare un consiglio
 *    sbagliato. Il suo indice si calcola sulle componenti disponibili con i pesi
 *    rinormalizzati, ed espone `copertura` — su quante gambe sta in piedi.
 *    E' la regola `null` != zero applicata a una formula pesata.
 */

/**
 * Pesi delle quattro componenti. Sommano a 1.
 *
 * Sono una proposta tarabile, non una verita': la specifica da' le direzioni
 * ("premia l'impostazione", "penalizza i cartellini") ma non le intensita'.
 * Stanno qui esportati proprio perche' si possano cambiare guardando le
 * classifiche che producono su dati veri, senza toccare la logica.
 */
export const MODIFIER_WEIGHTS = {
  /** Quanto conta la solidita' difensiva della squadra. La componente piu' pesante. */
  difesaSquadra: 0.35,
  /** Partecipazione alla manovra: xGBuildup. */
  impostazione: 0.25,
  /** Bonus potenziali: xG + xA (gol, assist, piazzati). */
  bonus: 0.25,
  /** Malus storici: ammonizioni ed espulsioni per 90'. */
  disciplina: 0.15,
} as const;

export type ModifierComponent = keyof typeof MODIFIER_WEIGHTS;

/**
 * Quota del pressing sotto la quale scatta la penalita' per rischio cartellini.
 *
 * PPDA basso = pressing aggressivo: la squadra aggredisce alto e i difensori
 * fanno piu' falli tattici. Il verso e' contro-intuitivo ed e' il motivo per cui
 * questa costante ha un nome esplicito invece di essere un `< 10` sparso.
 *
 * La soglia e' un *percentile*, non un valore: 10 di PPDA significa cose diverse
 * in campionati diversi, ma "fra le squadre che pressano piu' aggressivamente"
 * si legge uguale ovunque.
 */
export const PPDA_PERCENTILE_AGGRESSIVO = 0.25;

export interface ModifierCandidate {
  playerId: number;
  nome: string;
  squadra: string;
  /** Quotazione attuale: non entra nell'indice, serve a leggerlo. */
  costo: number;
  performance: SeasonPerformance | null;
  advanced: AdvancedMetrics | null;
  team: Team | null;
}

export interface ModifierBreakdown {
  /** 0..1 per ogni componente calcolabile; assente = dato mancante. */
  componenti: Partial<Record<ModifierComponent, number>>;
  /** Peso complessivo delle componenti disponibili, prima della rinormalizzazione. */
  copertura: number;
}

export interface ModifierScore {
  playerId: number;
  nome: string;
  squadra: string;
  costo: number;
  /** 0..100. Confrontabile solo dentro lo stesso insieme di candidati. */
  indice: number;
  breakdown: ModifierBreakdown;
}

/**
 * Rango di ogni valore nell'insieme, fra 0 e 1.
 *
 * I `null` restano `null`: non sono zeri in fondo alla classifica, sono assenze.
 *
 * Con un solo valore il rango e' 0.5 e non 1: un candidato solo non e' "il
 * migliore", e' l'unico — dargli il massimo lo farebbe sembrare eccezionale a
 * chiunque legga il punteggio senza sapere quanti erano.
 */
export function percentili(valori: ReadonlyArray<number | null>): Array<number | null> {
  const presenti = valori.filter((v): v is number => v !== null);
  if (presenti.length === 0) return valori.map(() => null);
  if (presenti.length === 1) return valori.map((v) => (v === null ? null : 0.5));

  const ordinati = [...presenti].sort((a, b) => a - b);
  const minimo = ordinati[0]!;
  const massimo = ordinati[ordinati.length - 1]!;

  // Tutti uguali: nessuno si distingue, e spalmarli su 0..1 inventerebbe un
  // ordinamento che nei dati non c'e'.
  if (minimo === massimo) return valori.map((v) => (v === null ? null : 0.5));

  return valori.map((v) => {
    if (v === null) return null;
    // Rango medio, cosi' i pari merito ricevono lo stesso punteggio invece di
    // dipendere dall'ordine in cui sono arrivati.
    const minori = ordinati.filter((x) => x < v).length;
    const uguali = ordinati.filter((x) => x === v).length;
    return (minori + (uguali - 1) / 2) / (ordinati.length - 1);
  });
}

/** Cartellini per 90 minuti, con l'espulsione pesata come tre ammonizioni. */
export function malusPer90(performance: SeasonPerformance | null): number | null {
  if (performance === null) return null;
  const { ammonizioni, espulsioni, minuti } = performance;
  if (minuti === null || minuti <= 0) return null;
  if (ammonizioni === null && espulsioni === null) return null;

  // Un rosso costa una partita di squalifica oltre al malus: pesarlo come un
  // giallo qualunque sottostimerebbe il difensore falloso.
  const pesato = (ammonizioni ?? 0) + (espulsioni ?? 0) * 3;
  return (pesato * 90) / minuti;
}

/** Bonus potenziali: gol e assist attesi messi insieme. */
export function bonusAttesi(advanced: AdvancedMetrics | null): number | null {
  if (advanced === null) return null;
  const { xg, xa } = advanced;
  if (xg === null && xa === null) return null;
  return (xg ?? 0) + (xa ?? 0);
}

/**
 * Calcola l'indice per un insieme di candidati.
 *
 * Si lavora sull'insieme e non sul singolo per costruzione: i percentili
 * esistono solo rispetto a una popolazione, e un indice "assoluto" per un
 * giocatore isolato non avrebbe significato.
 */
export function calcolaIndiceModificatore(
  candidati: ReadonlyArray<ModifierCandidate>
): ModifierScore[] {
  if (candidati.length === 0) return [];

  // --- Le quattro colonne grezze, prima dei percentili.
  // xGA basso e' un pregio: si nega per far coincidere "piu' alto" con "meglio"
  // su tutte le componenti, cosi' la combinazione finale e' una somma pesata e
  // non un misto di segni da ricordarsi.
  const difesa = candidati.map((c) =>
    c.team?.xgaTotali === undefined || c.team?.xgaTotali === null ? null : -c.team.xgaTotali
  );
  const impostazione = candidati.map((c) => c.advanced?.xgBuildup ?? null);
  const bonus = candidati.map((c) => bonusAttesi(c.advanced));
  // Idem: meno malus, meglio e'.
  const disciplina = candidati.map((c) => {
    const malus = malusPer90(c.performance);
    return malus === null ? null : -malus;
  });

  const pDifesa = percentili(difesa);
  const pImpostazione = percentili(impostazione);
  const pBonus = percentili(bonus);
  const pDisciplina = percentili(disciplina);

  // Il pressing si valuta rispetto alle altre squadre presenti fra i candidati:
  // "aggressivo" e' una posizione in classifica, non un numero fisso.
  const pPressing = percentili(
    candidati.map((c): number | null => c.team?.ppdaStagione ?? null)
  );

  return candidati.map((candidato, i) => {
    const componenti: Partial<Record<ModifierComponent, number>> = {};

    // `?? null` e non `!`: con `noUncheckedIndexedAccess` un accesso indicizzato
    // puo' essere `undefined`, e qui "fuori indice" e "dato assente" devono
    // collassare sullo stesso significato.
    if (pDifesa[i] != null) {
      componenti.difesaSquadra = penalizzaPressing(pDifesa[i]!, pPressing[i] ?? null);
    }
    if (pImpostazione[i] !== null) componenti.impostazione = pImpostazione[i]!;
    if (pBonus[i] !== null) componenti.bonus = pBonus[i]!;
    if (pDisciplina[i] !== null) componenti.disciplina = pDisciplina[i]!;

    const { indice, copertura } = combina(componenti);

    return {
      playerId: candidato.playerId,
      nome: candidato.nome,
      squadra: candidato.squadra,
      costo: candidato.costo,
      indice,
      breakdown: { componenti, copertura },
    };
  });
}

/**
 * Sconta la solidita' difensiva quando la squadra pressa troppo alto.
 *
 * Una difesa che subisce poco *perche'* aggredisce a tutto campo espone i suoi
 * difensori a falli tattici, e per il fantacalcio il cartellino e' un malus
 * certo contro un modificatore probabile. La penalita' e' proporzionale a quanto
 * la squadra sta sotto la soglia, non un gradino: due squadre appena ai lati di
 * un confine netto riceverebbero giudizi molto diversi per una differenza
 * trascurabile.
 */
function penalizzaPressing(percentileDifesa: number, percentilePpda: number | null): number {
  if (percentilePpda === null || percentilePpda >= PPDA_PERCENTILE_AGGRESSIVO) {
    return percentileDifesa;
  }
  const quantoSotto = (PPDA_PERCENTILE_AGGRESSIVO - percentilePpda) / PPDA_PERCENTILE_AGGRESSIVO;
  // Al massimo un terzo del merito difensivo: il pressing alto resta comunque
  // un contesto migliore di una difesa che prende gol.
  return percentileDifesa * (1 - quantoSotto / 3);
}

/**
 * Somma pesata con rinormalizzazione sulle componenti disponibili.
 *
 * `copertura` e' il peso originale di quel che c'era: 1 significa dato completo,
 * 0.35 che l'indice sta in piedi su una gamba sola e va letto con prudenza.
 */
function combina(componenti: Partial<Record<ModifierComponent, number>>): {
  indice: number;
  copertura: number;
} {
  let somma = 0;
  let pesoDisponibile = 0;

  for (const [nome, valore] of Object.entries(componenti) as Array<
    [ModifierComponent, number]
  >) {
    const peso = MODIFIER_WEIGHTS[nome];
    somma += valore * peso;
    pesoDisponibile += peso;
  }

  if (pesoDisponibile === 0) return { indice: 0, copertura: 0 };

  return {
    indice: Math.round((somma / pesoDisponibile) * 1000) / 10,
    copertura: Math.round(pesoDisponibile * 100) / 100,
  };
}

/**
 * Ordina per indice decrescente, con l'id come spareggio.
 *
 * Lo spareggio non e' pignoleria: senza, due giocatori a pari punteggio
 * cambierebbero posto fra una chiamata e l'altra a seconda dell'ordine in cui
 * sono arrivati, e una lista che si riordina da sola mentre la guardi in asta e'
 * peggio di una lista sbagliata.
 */
export function ordinaPerIndice(scores: ReadonlyArray<ModifierScore>): ModifierScore[] {
  return [...scores].sort((a, b) => b.indice - a.indice || a.playerId - b.playerId);
}
