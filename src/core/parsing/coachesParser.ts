import type { GoalSplit, Team } from '@/domain/team';

/**
 * Lettura di `dataset/coaches.json`.
 *
 * Puro: nessun import di asset, nessuna dipendenza Expo. La separazione è la
 * stessa di `csvParser.ts` / `listoneAsset.ts` — la logica si testa in Jest
 * senza ambiente nativo, e il file che tocca il bundler sta da un'altra parte.
 *
 * Il file è generato da Python contro fonti che cambiano senza preavviso, quindi
 * vale la regola già applicata al seme d'asta e al dataset: **si scarta la
 * squadra rotta, non il file**. Con diciannove squadre su venti si lavora; con
 * zero no.
 */

export interface CoachesResult {
  teams: Team[];
  skipped: Array<{ squadra: unknown; reason: string }>;
}

export type CoachesOutcome =
  | { ok: true; value: CoachesResult }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Un numero, oppure `null`.
 *
 * `null` e assente collassano di proposito: nel JSON una neopromossa ha
 * `xg_totali: null` perché in Serie A non ha giocato, ed è esattamente lo stesso
 * significato di una chiave mancante. Zero invece direbbe "non tira mai".
 */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toGoalSplit(raw: unknown): GoalSplit | null {
  if (!isObject(raw)) return null;

  const campi = [
    'difensori',
    'centrocampisti',
    'attaccanti',
    'totale',
    'difensori_perc',
    'centrocampisti_perc',
    'attaccanti_perc',
  ] as const;

  const valori: number[] = [];
  for (const campo of campi) {
    const n = toNumberOrNull(raw[campo]);
    // Una distribuzione a metà non è una distribuzione: se manca un pezzo si
    // scarta il blocco intero invece di comporne uno con dei buchi.
    if (n === null) return null;
    valori.push(n);
  }

  return {
    difensori: valori[0]!,
    centrocampisti: valori[1]!,
    attaccanti: valori[2]!,
    totale: valori[3]!,
    difensoriPerc: valori[4]!,
    centrocampistiPerc: valori[5]!,
    attaccantiPerc: valori[6]!,
  };
}

export function parseCoaches(raw: unknown): CoachesOutcome {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Atteso un array di squadre in coaches.json.' };
  }
  if (raw.length === 0) {
    return { ok: false, error: 'coaches.json è vuoto: nessuna squadra da leggere.' };
  }

  const teams: Team[] = [];
  const skipped: CoachesResult['skipped'] = [];
  const visti = new Set<string>();

  for (const voce of raw) {
    if (!isObject(voce)) {
      skipped.push({ squadra: voce, reason: 'voce non è un oggetto' });
      continue;
    }

    const nome = toStringOrNull(voce.squadra);
    if (nome === null) {
      skipped.push({ squadra: voce.squadra, reason: 'nome squadra mancante' });
      continue;
    }

    // Il nome è la chiave di join col listone: due righe per la stessa squadra
    // renderebbero arbitrario quale profilo tattico vince.
    const chiave = nome.toLowerCase();
    if (visti.has(chiave)) {
      skipped.push({ squadra: nome, reason: 'squadra duplicata' });
      continue;
    }
    visti.add(chiave);

    teams.push({
      nome,
      allenatore: toStringOrNull(voce.allenatore),
      moduloBase: toStringOrNull(voce.modulo_base),
      xgTotali: toNumberOrNull(voce.xg_totali),
      xgaTotali: toNumberOrNull(voce.xga_totali),
      ppdaStagione: toNumberOrNull(voce.ppda_stagione),
      giocatoriImpiegati: toNumberOrNull(voce.giocatori_impiegati_storico),
      gialliTotali: toNumberOrNull(voce.gialli_totali),
      rossiTotali: toNumberOrNull(voce.rossi_totali),
      distribuzioneGol: toGoalSplit(voce.distribuzione_gol),
    });
  }

  if (teams.length === 0) {
    return { ok: false, error: 'Nessuna squadra valida in coaches.json.' };
  }

  return { ok: true, value: { teams, skipped } };
}

/**
 * Indice per nome normalizzato.
 *
 * Il listone scrive `Milan` e `coaches.json` pure — la pipeline Python si
 * occupa già di riportare tutto al vocabolario del listone. Qui basta quindi
 * minuscolo e spazi collassati: non serve rifare `normalize_team`, e rifarlo a
 * metà sarebbe peggio che non farlo.
 */
export function indexByTeam(teams: Team[]): Record<string, Team> {
  const indice: Record<string, Team> = {};
  for (const team of teams) {
    indice[teamKey(team.nome)] = team;
  }
  return indice;
}

export function teamKey(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ').toLowerCase();
}
