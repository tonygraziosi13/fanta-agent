import type { Player } from '@/domain/player';
import {
  formatInt,
  formatMetric,
  isPer90Reliable,
  per90,
  performanceVerdict,
  riskBand,
  type PerformanceVerdict,
  type RiskBand,
} from '@/domain/metrics';
import { hasAnyValue, type PlayerStats } from '@/domain/playerStats';

/**
 * Selettori della schermata di dettaglio (US21-T2).
 *
 * Puri, senza React e senza SQLite: la schermata deve limitarsi a disporre in
 * pagina cio' che qui e' gia' stato deciso. E' anche il motivo per cui l'agente
 * potra' rispondere "Lautaro ha sovraperformato l'xG" senza ridurre le stesse
 * soglie in un altro punto del codice.
 */

export interface MetricLine {
  label: string;
  value: string;
  /** Valore normalizzato 0..1 per le barre; null = niente barra. */
  ratio?: number | null;
  hint?: string;
}

export interface StatSection {
  id: string;
  title: string;
  lines: MetricLine[];
  /** false = la sezione non ha un solo dato e va nascosta (US21-2). */
  available: boolean;
}

export function selectEconomics(player: Player): StatSection {
  return {
    id: 'economics',
    title: 'Dati economici',
    available: true,
    lines: [
      { label: 'Quotazione attuale', value: String(player.qt_a) },
      { label: 'Quotazione iniziale', value: String(player.qt_i) },
      {
        label: 'Variazione',
        value: player.diff > 0 ? `+${player.diff}` : String(player.diff),
        hint: player.diff === 0 ? 'invariata dall’inizio del mercato' : undefined,
      },
      { label: 'FantaValore di Mercato', value: String(player.fvm) },
      { label: 'Quotazione Mantra', value: String(player.qt_a_m) },
      { label: 'FVM Mantra', value: String(player.fvm_m) },
    ],
  };
}

export function selectPerformance(stats: PlayerStats | undefined): StatSection {
  const p = stats?.performance;
  const values = p
    ? [p.presenze, p.minuti, p.mediaVoto, p.fantamedia, p.gol, p.assist]
    : [];

  return {
    id: 'performance',
    title: 'Rendimento storico',
    available: hasAnyValue(values),
    lines: p
      ? [
          { label: 'Presenze', value: formatInt(p.presenze) },
          { label: 'Minuti giocati', value: formatInt(p.minuti) },
          // La fantamedia e' il numero che decide un'asta: la barra e' tarata
          // sulla scala reale del voto (0..10), non sul massimo del campione,
          // cosi' due giocatori restano confrontabili a colpo d'occhio.
          { label: 'Media voto', value: formatMetric(p.mediaVoto, 2), ratio: toRatio(p.mediaVoto, 10) },
          { label: 'Fantamedia', value: formatMetric(p.fantamedia, 2), ratio: toRatio(p.fantamedia, 12) },
          { label: 'Gol', value: formatInt(p.gol) },
          { label: 'Assist', value: formatInt(p.assist) },
          { label: 'Ammonizioni', value: formatInt(p.ammonizioni) },
          { label: 'Espulsioni', value: formatInt(p.espulsioni) },
        ]
      : [],
  };
}

export interface AnalyticsSection extends StatSection {
  /** Gol contro xG: il giudizio sulla sostenibilita' del rendimento. */
  goalVerdict: PerformanceVerdict | null;
  assistVerdict: PerformanceVerdict | null;
  /** false = troppi pochi minuti perche' i valori per-90 significhino qualcosa. */
  per90Reliable: boolean;
}

export function selectAnalytics(stats: PlayerStats | undefined): AnalyticsSection {
  const a = stats?.advanced;
  const minuti = stats?.performance.minuti ?? null;
  const values = a ? [a.xg, a.npxg, a.xa, a.xgChain, a.xgBuildup, a.tiri, a.keyPasses] : [];

  return {
    id: 'analytics',
    title: 'Metriche analitiche',
    available: hasAnyValue(values),
    goalVerdict: performanceVerdict(stats?.performance.gol ?? null, a?.xg ?? null),
    assistVerdict: performanceVerdict(stats?.performance.assist ?? null, a?.xa ?? null),
    per90Reliable: isPer90Reliable(minuti),
    lines: a
      ? [
          { label: 'xG (gol attesi)', value: formatMetric(a.xg) },
          { label: 'xG su azione', value: formatMetric(a.npxg), hint: 'rigori esclusi' },
          { label: 'xA (assist attesi)', value: formatMetric(a.xa) },
          {
            label: 'xG per 90′',
            value: formatMetric(per90(a.xg, minuti)),
            hint: isPer90Reliable(minuti) ? undefined : 'pochi minuti: dato poco indicativo',
          },
          { label: 'Tiri', value: formatInt(a.tiri) },
          { label: 'Passaggi chiave', value: formatInt(a.keyPasses) },
          { label: 'xG Chain', value: formatMetric(a.xgChain), hint: 'azioni in cui è coinvolto' },
          { label: 'xG Buildup', value: formatMetric(a.xgBuildup), hint: 'costruzione, senza tiro e assist' },
        ]
      : [],
  };
}

export interface InjurySection extends StatSection {
  band: RiskBand | null;
  risk: number | null;
}

export function selectInjuries(stats: PlayerStats | undefined): InjurySection {
  const i = stats?.injuries;

  return {
    id: 'injuries',
    title: 'Rischio infortuni',
    available: i !== undefined && hasAnyValue([i.days, i.matches, i.risk]),
    band: riskBand(i?.risk ?? null),
    risk: i?.risk ?? null,
    lines: i
      ? [
          { label: 'Giorni di stop', value: formatInt(i.days), hint: 'ultime 3 stagioni' },
          { label: 'Partite saltate', value: formatInt(i.matches) },
          { label: 'Episodi registrati', value: String(i.history.length) },
        ]
      : [],
  };
}

function toRatio(value: number | null, max: number): number | null {
  if (value === null) return null;
  return Math.min(Math.max(value / max, 0), 1);
}

/**
 * Il messaggio da mostrare quando una fonte non copre il giocatore.
 * Distingue i due casi che l'utente confonderebbe: "non ha giocato" e "non
 * abbiamo il dato".
 */
export function describeMissingData(stats: PlayerStats | undefined): string {
  if (stats === undefined) {
    return 'Nessuna statistica disponibile per questo calciatore: non ha ancora giocato in Serie A, oppure il dataset non lo copre.';
  }
  return 'Dato non disponibile da questa fonte.';
}
