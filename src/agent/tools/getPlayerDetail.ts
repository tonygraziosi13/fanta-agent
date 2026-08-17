import { getStatsByPlayerId } from '@/core/repositories/playerStatsRepository';
import { per90, performanceVerdict, riskBand } from '@/domain/metrics';
import { usePlayersStore } from '@/state/usePlayersStore';
import type { AgentTool } from '../types';

interface GetPlayerDetailInput {
  player_id: number;
}

/**
 * Scheda completa di un calciatore per l'agente (US21, lato LLM).
 *
 * Riusa `playerStatsRepository` e le funzioni di `domain/metrics.ts`, le stesse
 * che alimentano la schermata: se un giorno la soglia di sovraperformance
 * cambiasse, cambierebbe insieme per la UI e per il modello. Un tool che
 * ricalcolasse le sue soglie sarebbe la premessa perche' agente e schermata
 * dicano due cose diverse dello stesso giocatore.
 *
 * I `null` viaggiano fino al modello senza essere addolciti: un LLM che riceve
 * `xg: 0` conclude che il giocatore non tira mai, mentre `xg: null` piu' il
 * campo `coverage` gli dicono che il dato non c'e' — e puo' dirlo all'utente.
 */
export const getPlayerDetailTool: AgentTool<GetPlayerDetailInput> = {
  name: 'get_player_detail',
  description:
    'Restituisce la scheda completa di un calciatore: quotazioni, rendimento della ' +
    'stagione scorsa, metriche avanzate (xG, xA), rischio infortuni e copertura delle ' +
    'fonti. I valori null indicano dati non disponibili, non valori pari a zero.',
  input_schema: {
    type: 'object',
    properties: {
      player_id: { type: 'number', description: 'Id del calciatore nel listone.' },
    },
    required: ['player_id'],
  },
  handler: async ({ player_id }) => {
    const player = usePlayersStore.getState().byId[player_id];
    if (!player) {
      return { trovato: false, motivo: `Nessun calciatore con id ${player_id}.` };
    }

    const stats = await getStatsByPlayerId(player_id);

    const anagrafica = {
      id: player.id,
      nome: player.nome,
      squadra: player.squadra,
      ruolo: player.r,
      ruolo_mantra: player.rm,
      in_serie_a: player.is_active,
      quotazione: player.qt_a,
      quotazione_iniziale: player.qt_i,
      fvm: player.fvm,
    };

    if (stats === null) {
      return {
        trovato: true,
        ...anagrafica,
        statistiche: null,
        nota: 'Nessuna statistica disponibile: il calciatore non ha giocato in Serie A nella stagione di riferimento, oppure il dataset non lo copre.',
      };
    }

    const { performance, advanced, injuries } = stats;

    return {
      trovato: true,
      ...anagrafica,
      stagione: stats.season,
      rendimento: performance,
      metriche_avanzate: {
        ...advanced,
        xg_per_90: per90(advanced.xg, performance.minuti),
        xa_per_90: per90(advanced.xa, performance.minuti),
      },
      giudizio: {
        gol_vs_xg: performanceVerdict(performance.gol, advanced.xg),
        assist_vs_xa: performanceVerdict(performance.assist, advanced.xa),
      },
      infortuni: {
        giorni_stop: injuries.days,
        partite_saltate: injuries.matches,
        indice_rischio: injuries.risk,
        fascia: riskBand(injuries.risk),
        episodi: injuries.history.length,
      },
      // Il modello deve poter distinguere "non lo so" da "vale zero".
      copertura_fonti: stats.coverage,
    };
  },
};
