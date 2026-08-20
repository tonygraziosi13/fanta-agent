import type { Player } from '@/domain/player';
import type { Coverage, PlayerStats } from '@/domain/playerStats';
import { isClassicRole } from '@/domain/roles';
import type { DatasetPayload, RemotePlayer } from './types';

/**
 * Traduzione payload remoto -> entita' di dominio (US20-T3).
 *
 * Gemello di `listoneMapper.ts`, e ne eredita la politica sugli errori: una
 * riga malformata viene scartata e registrata, non fa abortire l'aggiornamento.
 * Meglio 504 giocatori aggiornati su 505 che un'app ferma ai dati del mese
 * scorso perche' un record aveva il ruolo scritto male.
 *
 * Puro: nessun accesso al DB, nessuna dipendenza nativa. E' testabile in Jest,
 * ed e' il punto in cui si verifica che le metriche non diventino zeri.
 */

export interface MappedDataset {
  players: Player[];
  stats: PlayerStats[];
  skipped: Array<{ id: unknown; reason: string }>;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Gli interi del listone non sono mai assenti: mancante o illeggibile vale 0. */
function toInt(value: unknown): number {
  const n = toNumberOrNull(value);
  return n === null ? 0 : Math.round(n);
}

function toCoverage(raw: unknown): Coverage {
  if (typeof raw !== 'object' || raw === null) return {};
  const coverage: Coverage = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true) coverage[key as keyof Coverage] = true;
  }
  return coverage;
}

function mapPlayer(remote: RemotePlayer): Player | null {
  const id = toInt(remote.id);
  if (id <= 0) return null;

  const role = String(remote.r ?? '').toUpperCase();
  if (!isClassicRole(role)) return null;

  const nome = String(remote.nome ?? '');
  if (nome === '') return null;

  const q = remote.quotazioni ?? ({} as RemotePlayer['quotazioni']);

  return {
    id,
    r: role,
    rm: remote.rm === null || remote.rm === undefined || remote.rm === '' ? null : String(remote.rm),
    nome,
    squadra: String(remote.squadra ?? ''),
    qt_a: toInt(q.qt_a),
    qt_i: toInt(q.qt_i),
    diff: toInt(q.diff),
    qt_a_m: toInt(q.qt_a_m),
    qt_i_m: toInt(q.qt_i_m),
    diff_m: toInt(q.diff_m),
    fvm: toInt(q.fvm),
    fvm_m: toInt(q.fvm_m),
    // Assente => attivo, come gia' fa il mapper del CSV bundlato.
    is_active: remote.is_active !== false,
  };
}

function mapStats(remote: RemotePlayer, season: string, updatedAt: number): PlayerStats {
  const p = remote.performance ?? ({} as RemotePlayer['performance']);
  const a = remote.advanced ?? ({} as RemotePlayer['advanced']);
  const i = remote.injuries ?? ({} as RemotePlayer['injuries']);

  return {
    playerId: toInt(remote.id),
    season,
    performance: {
      presenze: toNumberOrNull(p.presenze),
      minuti: toNumberOrNull(p.minuti),
      mediaVoto: toNumberOrNull(p.media_voto),
      fantamedia: toNumberOrNull(p.fantamedia),
      gol: toNumberOrNull(p.gol),
      assist: toNumberOrNull(p.assist),
      ammonizioni: toNumberOrNull(p.ammonizioni),
      espulsioni: toNumberOrNull(p.espulsioni),
    },
    advanced: {
      xg: toNumberOrNull(a.xg),
      npxg: toNumberOrNull(a.npxg),
      xa: toNumberOrNull(a.xa),
      xgChain: toNumberOrNull(a.xg_chain),
      xgBuildup: toNumberOrNull(a.xg_buildup),
      tiri: toNumberOrNull(a.tiri),
      keyPasses: toNumberOrNull(a.key_passes),
    },
    injuries: {
      days: toNumberOrNull(i.days),
      matches: toNumberOrNull(i.matches),
      risk: toNumberOrNull(i.risk),
      history: Array.isArray(i.history)
        ? i.history.map((spell) => ({
            season: String(spell?.season ?? ''),
            type: String(spell?.type ?? ''),
            days: toNumberOrNull(spell?.days),
            matches: toNumberOrNull(spell?.matches),
          }))
        : [],
    },
    coverage: toCoverage(remote.coverage),
    updatedAt,
  };
}

/**
 * Le metriche vengono scritte solo per chi ha almeno una fonte che lo copre.
 * Una riga di soli `null` occuperebbe spazio per dire quel che l'assenza della
 * riga dice gia', e renderebbe indistinguibile "mai sincronizzato" da
 * "sincronizzato, nessuna fonte lo conosce".
 */
function hasCoverage(coverage: Coverage): boolean {
  return Object.values(coverage).some(Boolean);
}

export function mapDataset(payload: DatasetPayload, now: number = Date.now()): MappedDataset {
  const players: Player[] = [];
  const stats: PlayerStats[] = [];
  const skipped: MappedDataset['skipped'] = [];

  for (const remote of payload.players) {
    const player = mapPlayer(remote);
    if (player === null) {
      skipped.push({ id: remote?.id, reason: 'id, ruolo o nome non validi' });
      continue;
    }

    players.push(player);

    const playerStats = mapStats(remote, payload.season, now);
    if (hasCoverage(playerStats.coverage)) stats.push(playerStats);
  }

  return { players, stats, skipped };
}
