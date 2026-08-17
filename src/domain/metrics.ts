/**
 * Interpretazione delle metriche: soglie, fasce e derivate.
 *
 * Vive nel dominio e non nel theme ne' nei componenti, per la stessa ragione per
 * cui ci vivono i colori dei ruoli (`roles.ts`): dire che un attaccante ha
 * "sovraperformato" o che un giocatore e' "ad alto rischio" e' un giudizio di
 * dominio, non una scelta grafica. Qui e' testabile in Jest senza montare nulla,
 * ed e' riusabile dall'agente tanto quanto dalla UI.
 *
 * Le funzioni sono pure e tollerano `null` ovunque: le fonti coprono i
 * giocatori in modo diseguale (vedi `playerStats.ts`).
 */

/** Un valore per 90 minuti: l'unica forma in cui due giocatori sono confrontabili. */
export function per90(value: number | null, minuti: number | null): number | null {
  if (value === null || minuti === null || minuti <= 0) return null;
  return (value * 90) / minuti;
}

/**
 * Minuti sotto i quali una metrica per-90 e' rumore statistico.
 * ~3 partite piene: sotto, un singolo episodio distorce il rapporto.
 */
export const MIN_MINUTES_FOR_PER90 = 270;

export function isPer90Reliable(minuti: number | null): boolean {
  return minuti !== null && minuti >= MIN_MINUTES_FOR_PER90;
}

export type PerformanceVerdict = 'over' | 'inLinea' | 'under';

/**
 * Confronto fra realizzato e atteso (gol vs xG, assist vs xA).
 *
 * La soglia e' assoluta e non percentuale: su numeri piccoli — e a fine stagione
 * quasi tutti i valori xG lo sono — una soglia percentuale classificherebbe come
 * "sovraperformance clamorosa" uno scarto di mezzo gol.
 */
export const PERFORMANCE_TOLERANCE = 1.5;

export function performanceVerdict(
  actual: number | null,
  expected: number | null
): PerformanceVerdict | null {
  if (actual === null || expected === null) return null;
  const delta = actual - expected;
  if (delta > PERFORMANCE_TOLERANCE) return 'over';
  if (delta < -PERFORMANCE_TOLERANCE) return 'under';
  return 'inLinea';
}

export const VERDICT_LABELS: Record<PerformanceVerdict, string> = {
  over: 'Sopra le attese',
  inLinea: 'In linea',
  under: 'Sotto le attese',
};

/**
 * Verde/giallo/rosso non sono qui estetica: dicono se il rendimento e'
 * sostenibile. Chi segna molto piu' del suo xG tende a regredire l'anno dopo —
 * e' il malus implicito che un fantallenatore deve vedere prima di puntarci.
 */
export const VERDICT_COLORS: Record<PerformanceVerdict, string> = {
  over: '#22C55E',
  inLinea: '#94A3B8',
  under: '#F5C518',
};

export type RiskBand = 'basso' | 'medio' | 'alto';

/** Confini delle fasce sull'indice 0..1 calcolato dalla pipeline. */
export const RISK_THRESHOLDS = { medio: 0.25, alto: 0.5 } as const;

export function riskBand(risk: number | null): RiskBand | null {
  if (risk === null) return null;
  if (risk >= RISK_THRESHOLDS.alto) return 'alto';
  if (risk >= RISK_THRESHOLDS.medio) return 'medio';
  return 'basso';
}

export const RISK_LABELS: Record<RiskBand, string> = {
  basso: 'Rischio basso',
  medio: 'Rischio medio',
  alto: 'Rischio alto',
};

export const RISK_COLORS: Record<RiskBand, string> = {
  basso: '#22C55E',
  medio: '#F5C518',
  alto: '#EF4444',
};

/**
 * Frazione 0..1 per le barre di `StatBar`.
 * Satura invece di sforare: una barra oltre il contenitore e' un bug grafico,
 * e il numero esatto e' comunque scritto accanto.
 */
export function ratio(value: number | null, max: number): number | null {
  if (value === null || max <= 0) return null;
  return Math.min(Math.max(value / max, 0), 1);
}

/** Numero leggibile, o il trattino che segnala l'assenza del dato. */
export function formatMetric(value: number | null, decimals = 2): string {
  if (value === null) return '—';
  return value.toFixed(decimals);
}

export function formatInt(value: number | null): string {
  if (value === null) return '—';
  return String(Math.round(value));
}
