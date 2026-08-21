import { getDb } from '@/core/db/client';
import {
  abbinaRinomine,
  chiaveNome,
  rowToOpponent,
  type Opponent,
  type OpponentDbRow,
} from '@/domain/opponent';
import type { SeedTeam } from '@/core/parsing/statoAstaParser';

/**
 * Accesso alla tabella `opponents`.
 *
 * Come gli altri repository: nessuna logica di dominio, nessuno stato React.
 * L'import e' l'unica scrittura di massa e avviene in **una transazione**, per
 * la stessa ragione per cui ci avviene il sync — un import interrotto a meta'
 * lascerebbe l'asta con tre avversari su nove, che e' peggio di zero perche'
 * sembra un dato buono.
 */

export async function listOpponents(configId: number): Promise<Opponent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OpponentDbRow>(
    // La propria squadra per prima: e' quella che si guarda per prima, sia
    // nell'interfaccia sia in una risposta dell'agente.
    'SELECT * FROM opponents WHERE config_id = ? ORDER BY is_me DESC, nome COLLATE NOCASE',
    [configId]
  );
  return rows.map(rowToOpponent);
}

export async function countOpponents(configId: number): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM opponents WHERE config_id = ?',
    [configId]
  );
  return row?.n ?? 0;
}

/**
 * Sostituisce gli avversari di una configurazione con quelli importati.
 *
 * Sostituisce e non fonde, ed e' deliberato: il merge che preserva crediti e
 * rose esiste gia' **a monte**, in `scripts/dataset/asta.py`, dove c'e' lo
 * storico. Rifarlo anche qui darebbe due regole di fusione da tenere allineate,
 * e la seconda si scoprirebbe sbagliata durante un'asta.
 *
 * Il DELETE sta nella stessa transazione dell'INSERT: fra i due non esiste un
 * istante in cui l'asta ha zero partecipanti.
 */
export async function replaceOpponents(
  configId: number,
  teams: SeedTeam[]
): Promise<number> {
  const db = await getDb();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM opponents WHERE config_id = ?', [configId]);

    const statement = await db.prepareAsync(
      `INSERT INTO opponents
         (config_id, nome, proprietario, is_me, crediti,
          slot_p, slot_d, slot_c, slot_a, rosa, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    try {
      for (const team of teams) {
        await statement.executeAsync([
          configId,
          team.nome,
          team.proprietario,
          team.isMe ? 1 : 0,
          team.creditiResidui,
          team.slotLiberi.P,
          team.slotLiberi.D,
          team.slotLiberi.C,
          team.slotLiberi.A,
          team.rosa.length > 0 ? JSON.stringify(team.rosa) : null,
          now,
        ]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });

  return teams.length;
}

/**
 * Riscrive crediti, slot e rosa di un singolo partecipante.
 *
 * Riga intera e non aggiornamento incrementale (`crediti = crediti - ?`), ed e'
 * deliberato: lo stato in memoria e' gia' quello corretto — `reduce` l'ha
 * calcolato nello stesso frame del tocco — e la persistenza si limita a
 * fotografarlo. Con un decremento relativo, un `effect` ripetuto per un
 * ritentativo scalerebbe i crediti due volte; scrivendo il valore assoluto,
 * riscrivere lo stesso stato non cambia nulla.
 *
 * E' anche cio' che rende innocua la sovrapposizione di due acquisti rapidi: la
 * seconda scrittura porta lo stato dopo entrambi, e converge.
 */
export async function saveOpponentState(opponent: Opponent): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE opponents
        SET crediti = ?, slot_p = ?, slot_d = ?, slot_c = ?, slot_a = ?,
            rosa = ?, updated_at = ?
      WHERE id = ?`,
    [
      opponent.creditiResidui,
      opponent.slotLiberi.P,
      opponent.slotLiberi.D,
      opponent.slotLiberi.C,
      opponent.slotLiberi.A,
      opponent.rosa.length > 0 ? JSON.stringify(opponent.rosa) : null,
      Date.now(),
      opponent.id,
    ]
  );
}

/**
 * Aggiunge i partecipanti mancanti, senza toccare quelli che ci sono gia'.
 *
 * E' l'operazione che serve quando una squadra si iscrive poco prima dell'asta,
 * ed e' **deliberatamente diversa** da `replaceOpponents`. Quella cancella e
 * riscrive: giusta per il primo import, letale se premuta a meta' asta, perche'
 * riporterebbe tutti a crediti pieni e rose vuote buttando via due ore di
 * lavoro senza chiedere niente a nessuno.
 *
 * Qui si aggiunge e basta. Una squadra gia' presente resta com'e' — crediti
 * scalati, rosa costruita — anche se il seme la descrive diversamente: il
 * dispositivo e' la fonte di verita' dal momento dell'import in poi, e il seme
 * e' una fotografia di quando lo scraper ha girato.
 *
 * Riallinea anche le squadre **rinominate** (vedi `abbinaRinomine`): senza,
 * chi cambia nome finirebbe al tavolo due volte, e la copia coi crediti pieni
 * sembrerebbe un avversario che puo' ancora rilanciare.
 *
 * Restituisce cosa e' cambiato e non un generico "fatto": chi preme il pulsante
 * deve poter smentire un accoppiamento che non torna.
 */
export interface MergeEsito {
  /** Squadre che al tavolo non c'erano. */
  aggiunte: string[];
  /** Squadre gia' al tavolo che hanno cambiato nome, non identita'. */
  rinominate: Array<{ da: string; a: string }>;
}

export async function mergeOpponents(
  configId: number,
  teams: SeedTeam[]
): Promise<MergeEsito> {
  const db = await getDb();
  const now = Date.now();

  const esistenti = await db.getAllAsync<{ id: number; nome: string; proprietario: string | null }>(
    'SELECT id, nome, proprietario FROM opponents WHERE config_id = ?',
    [configId]
  );
  // Confronto normalizzato: il sito puo' cambiare spaziatura o maiuscole di un
  // nome senza che sia un'altra squadra, e re-inserirla creerebbe un doppione
  // con la rosa vuota accanto a quella vera.
  const gia = new Set(esistenti.map((r) => chiaveNome(r.nome)));
  const candidate = teams.filter((t) => !gia.has(chiaveNome(t.nome)));

  // --- Rinomine, prima di decidere chi e' nuovo ---
  // Una rinomina cambia due esiti in una volta: la squadra "nuova" non e' nuova,
  // e quella che manca dall'elenco non se n'e' andata. La regola sta nel dominio
  // (`abbinaRinomine`) perche' e' un giudizio sull'identita' di un avversario, e
  // qui non sarebbe verificabile senza un database.
  const nelSeme = new Set(teams.map((t) => chiaveNome(t.nome)));
  const rinomine = abbinaRinomine(
    candidate,
    esistenti.filter((r) => !nelSeme.has(chiaveNome(r.nome)))
  );
  const rinominateChiavi = new Set(rinomine.map(({ nuova }) => chiaveNome(nuova.nome)));
  const nuove = candidate.filter((t) => !rinominateChiavi.has(chiaveNome(t.nome)));

  if (nuove.length === 0 && rinomine.length === 0) return { aggiunte: [], rinominate: [] };

  await db.withTransactionAsync(async () => {
    // Prima le rinomine: sono UPDATE su righe che restano le stesse, e farle
    // dentro la transazione degli INSERT significa che il tavolo non passa mai
    // per uno stato con la squadra vecchia e quella nuova insieme.
    for (const { nuova, vecchia } of rinomine) {
      await db.runAsync(
        'UPDATE opponents SET nome = ?, proprietario = ?, updated_at = ? WHERE id = ?',
        [nuova.nome, nuova.proprietario, now, vecchia.id]
      );
    }

    const statement = await db.prepareAsync(
      `INSERT INTO opponents
         (config_id, nome, proprietario, is_me, crediti,
          slot_p, slot_d, slot_c, slot_a, rosa, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    try {
      for (const team of nuove) {
        await statement.executeAsync([
          configId,
          team.nome,
          team.proprietario,
          team.isMe ? 1 : 0,
          team.creditiResidui,
          team.slotLiberi.P,
          team.slotLiberi.D,
          team.slotLiberi.C,
          team.slotLiberi.A,
          team.rosa.length > 0 ? JSON.stringify(team.rosa) : null,
          now,
        ]);
      }
    } finally {
      await statement.finalizeAsync();
    }
  });

  return {
    aggiunte: nuove.map((t) => t.nome),
    rinominate: rinomine.map(({ nuova, vecchia }) => ({ da: vecchia.nome, a: nuova.nome })),
  };
}
