import { findTeam } from '@/core/parsing/coachesAsset';
import { getStatsByPlayerId } from '@/core/repositories/playerStatsRepository';
import {
  calcolaIndiceModificatore,
  ordinaPerIndice,
  type ModifierCandidate,
} from '@/domain/modifierIndex';
import { xgaPer90 } from '@/domain/team';
import { selectSvincolatiPerRuolo } from '@/state/auctionSelectors';
import { useOpponentsStore } from '@/state/useOpponentsStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import type { AgentTool } from '../types';

interface Input {
  /** Quanti restituirne. Default 10. */
  limite?: number;
  /** Tetto di spesa: esclude chi costa piu' di cosi'. */
  costo_massimo?: number;
}

/**
 * Quick Action A: i difensori che valgono di piu' per il modificatore di difesa.
 *
 * --- Perche' non ordina per media voto ---
 * Fra il miglior difensore di Serie A e il peggiore ballano tre decimi di media
 * voto: su quella scala non si decide un'asta. Quel che distingue davvero un
 * difensore da modificatore sta nel contesto (una squadra che subisce poco alza
 * i voti di tutta la linea), nella partecipazione alla manovra e nei malus che
 * si porta dietro. La formula vive in `domain/modifierIndex.ts`.
 *
 * --- La scomposizione non e' ornamento ---
 * Ogni risultato porta il punteggio delle singole componenti e la `copertura`.
 * Un consiglio d'asta che non dice *perche'* non e' verificabile, e un indice
 * calcolato su una gamba sola — un giocatore di cui conosciamo solo la squadra —
 * va letto diversamente da uno completo. Nasconderlo trasformerebbe un'incertezza
 * in una certezza apparente.
 */
export const topDefendersModifierTool: AgentTool<Input> = {
  name: 'top_defenders_modifier',
  description:
    'Classifica i difensori ancora svincolati per "Indice Modificatore": combina ' +
    'la solidita difensiva della squadra, la partecipazione alla manovra (xG Buildup), ' +
    'i bonus attesi (xG+xA) e i malus da cartellini. Restituisce anche la scomposizione ' +
    'del punteggio e la copertura dei dati.',
  input_schema: {
    type: 'object',
    properties: {
      limite: { type: 'number', description: 'Quanti difensori restituire (default 10).' },
      costo_massimo: {
        type: 'number',
        description: 'Esclude i difensori che costano piu di questo valore.',
      },
    },
  },
  handler: async ({ limite = 10, costo_massimo } = {}) => {
    const players = usePlayersStore.getState().players;
    const opponents = useOpponentsStore.getState().items;

    let liberi = selectSvincolatiPerRuolo(players, opponents, 'D');
    if (typeof costo_massimo === 'number') {
      liberi = liberi.filter((p) => p.qt_a <= costo_massimo);
    }

    if (liberi.length === 0) {
      return {
        disponibili: false,
        messaggio:
          opponents.length === 0
            ? "Nessun partecipante importato: senza le rose non si sa chi e' ancora svincolato."
            : 'Nessun difensore svincolato con questi criteri.',
      };
    }

    // Le metriche si leggono una riga per volta, come fa la schermata di
    // dettaglio: sono letture su tap esplicito, fuori dal percorso caldo dello
    // scroll, e idratarle tutte al boot costerebbe memoria per dati che quasi
    // nessuno guardera'.
    const candidati: ModifierCandidate[] = await Promise.all(
      liberi.map(async (player) => {
        const stats = await getStatsByPlayerId(player.id);
        return {
          playerId: player.id,
          nome: player.nome,
          squadra: player.squadra,
          costo: player.qt_a,
          performance: stats?.performance ?? null,
          advanced: stats?.advanced ?? null,
          team: findTeam(player.squadra) ?? null,
        };
      })
    );

    const classifica = ordinaPerIndice(calcolaIndiceModificatore(candidati)).slice(0, limite);

    return {
      disponibili: true,
      valutati: candidati.length,
      difensori: classifica.map((score) => {
        const team = findTeam(score.squadra);
        return {
          nome: score.nome,
          squadra: score.squadra,
          costo: score.costo,
          indice: score.indice,
          copertura: score.breakdown.copertura,
          componenti: score.breakdown.componenti,
          contesto: {
            allenatore: team?.allenatore ?? null,
            modulo: team?.moduloBase ?? null,
            xga_per_90: team ? arrotonda(xgaPer90(team)) : null,
            ppda: team?.ppdaStagione ?? null,
          },
        };
      }),
    };
  },
};

function arrotonda(valore: number | null): number | null {
  return valore === null ? null : Math.round(valore * 100) / 100;
}
