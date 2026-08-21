import type { Player } from '@/domain/player';
import {
  RATING_COLORS,
  formatInt,
  formatMetric,
  isPer90Reliable,
  per90,
  performanceVerdict,
  ratingBand,
  riskBand,
  type PerformanceVerdict,
  type RatingBand,
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

/**
 * Una tessera della griglia "a colpo d'occhio".
 *
 * Esiste accanto a `lines` e non al suo posto: sono due letture della stessa
 * sezione, una veloce e una analitica, e la schermata usa l'una o l'altra a
 * seconda di quanto la sezione debba farsi leggere in fretta. Deciderlo qui e
 * non nel componente e' la stessa ragione per cui ci vive tutto il resto: la
 * schermata dispone, non interpreta.
 */
export interface StatTileData {
  label: string;
  value: string;
  tone?: string;
}

export interface EconomicsSection extends StatSection {
  /**
   * I tre numeri che vanno in testata, gia' formattati.
   *
   * Sono estratti qui e non presi dalla lista perche' in testata hanno un
   * altro mestiere: non sono voci di un elenco da scorrere, sono il valore su
   * cui si decide un rilancio. `lines` resta intatta — la usa ancora chi vuole
   * la lettura completa, e i test ci si appoggiano.
   */
  headline: {
    fvm: string;
    quotazione: string;
    variazione: string;
    trend: 'su' | 'giu' | 'fermo';
  };
  /** Le voci che la testata non mostra gia': evita di dire due volte la stessa cosa. */
  details: MetricLine[];
  /**
   * Titolo della card che raccoglie `details`.
   *
   * Diverso da `title` di proposito: con il FVM e la quotazione gia' in
   * testata, una seconda card intitolata "Dati economici" sembrerebbe
   * ripeterli. Questa dice esattamente cosa contiene, che e' il resto.
   */
  detailsTitle: string;
}

export function selectEconomics(player: Player): EconomicsSection {
  const details: MetricLine[] = [
    { label: 'Quotazione iniziale', value: String(player.qt_i) },
    { label: 'Quotazione Mantra', value: String(player.qt_a_m) },
    { label: 'FVM Mantra', value: String(player.fvm_m) },
  ];

  return {
    id: 'economics',
    title: 'Dati economici',
    available: true,
    headline: {
      fvm: String(player.fvm),
      quotazione: String(player.qt_a),
      variazione:
        player.diff > 0
          ? `+${player.diff}`
          : player.diff < 0
            ? `−${Math.abs(player.diff)}`
            : 'invariata',
      trend: player.diff > 0 ? 'su' : player.diff < 0 ? 'giu' : 'fermo',
    },
    details,
    detailsTitle: 'Altre quotazioni',
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

export interface PerformanceSection extends StatSection {
  /** I quattro numeri che si leggono per primi, in griglia. */
  tiles: StatTileData[];
  /** Fascia della fantamedia, per il badge in testa alla card. */
  ratingBand: RatingBand | null;
}

export function selectPerformance(stats: PlayerStats | undefined): PerformanceSection {
  const p = stats?.performance;
  const values = p
    ? [p.presenze, p.minuti, p.mediaVoto, p.fantamedia, p.gol, p.assist]
    : [];

  return {
    id: 'performance',
    title: 'Rendimento storico',
    available: hasAnyValue(values),
    ratingBand: ratingBand(p?.fantamedia ?? null),
    // Presenze, gol, assist e fantamedia: le quattro cose che un
    // fantallenatore guarda prima di tutto. I minuti e i cartellini restano
    // nella lista sotto — servono a interpretare, non a decidere.
    tiles: [
      { label: 'Presenze', value: formatInt(p?.presenze ?? null) },
      { label: 'Gol', value: formatInt(p?.gol ?? null) },
      { label: 'Assist', value: formatInt(p?.assist ?? null) },
      {
        label: 'Fantamedia',
        value: formatMetric(p?.fantamedia ?? null, 2),
        // Il numero si colora della sua fascia. Non e' un doppione del badge
        // in testa alla card: il colore qui e' il segnale — si coglie senza
        // leggere — e il badge e' la legenda che gli da' un nome.
        tone: colorOfRating(p?.fantamedia ?? null),
      },
    ],
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

/** I due valori del confronto realizzato/atteso, grezzi: il grafico li scala. */
export interface DuelData {
  actual: number | null;
  expected: number | null;
  actualLabel: string;
  expectedLabel: string;
}

export interface AnalyticsSection extends StatSection {
  /** Gol contro xG: il giudizio sulla sostenibilita' del rendimento. */
  goalVerdict: PerformanceVerdict | null;
  assistVerdict: PerformanceVerdict | null;
  /** false = troppi pochi minuti perche' i valori per-90 significhino qualcosa. */
  per90Reliable: boolean;
  goalDuel: DuelData;
  assistDuel: DuelData;
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
    goalDuel: {
      actual: stats?.performance.gol ?? null,
      expected: a?.xg ?? null,
      actualLabel: 'Gol',
      expectedLabel: 'Attesi',
    },
    assistDuel: {
      actual: stats?.performance.assist ?? null,
      expected: a?.xa ?? null,
      actualLabel: 'Assist',
      expectedLabel: 'Attesi',
    },
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

/** Il colore della fascia, o `undefined` per lasciare il numero neutro. */
function colorOfRating(fantamedia: number | null): string | undefined {
  const band = ratingBand(fantamedia);
  return band === null ? undefined : RATING_COLORS[band];
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
