import type { Player } from '@/domain/player';
import { isClassicRole } from '@/domain/roles';
import type { CsvRecord } from './csvParser';

/**
 * Mappa i record CSV (intestazioni ufficiali) sugli oggetti di dominio (US7-T2).
 *
 * L'header del listone ufficiale usa etichette non identificatori
 * ("Qt.A M", "Diff.", "FVM M"): la traduzione verso i campi snake_case vive
 * qui, in un solo punto. Se il tracciato ufficiale cambia, si tocca solo
 * questa mappa (e EXPECTED_HEADER in scripts/xlsx_to_csv.py).
 */
const COLUMN_MAP = {
  id: 'Id',
  r: 'R',
  rm: 'RM',
  nome: 'Nome',
  squadra: 'Squadra',
  qt_a: 'Qt.A',
  qt_i: 'Qt.I',
  diff: 'Diff.',
  qt_a_m: 'Qt.A M',
  qt_i_m: 'Qt.I M',
  diff_m: 'Diff.M',
  fvm: 'FVM',
  fvm_m: 'FVM M',
  is_active: 'IsActive',
} as const;

function toInt(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

export interface MapResult {
  players: Player[];
  /** Righe scartate con motivo: diagnosticabili senza far fallire l'intero import. */
  skipped: Array<{ row: number; reason: string }>;
}

/**
 * Politica sugli errori: una riga corrotta viene scartata e registrata, non fa
 * abortire l'import. Meglio un listone con 496 giocatori su 497 che un'app che
 * non si avvia; le righe scartate finiscono nei log del boot.
 */
export function mapRecordsToPlayers(records: CsvRecord[]): MapResult {
  const players: Player[] = [];
  const skipped: MapResult['skipped'] = [];

  records.forEach((record, index) => {
    const id = toInt(record[COLUMN_MAP.id]);
    if (id <= 0) {
      skipped.push({ row: index, reason: 'id mancante o non numerico' });
      return;
    }

    const role = (record[COLUMN_MAP.r] ?? '').toUpperCase();
    if (!isClassicRole(role)) {
      skipped.push({ row: index, reason: `ruolo Classic non valido: "${role}"` });
      return;
    }

    const nome = record[COLUMN_MAP.nome] ?? '';
    if (!nome) {
      skipped.push({ row: index, reason: 'nome vuoto' });
      return;
    }

    const rm = record[COLUMN_MAP.rm] ?? '';

    players.push({
      id,
      r: role,
      rm: rm === '' ? null : rm,
      nome,
      squadra: record[COLUMN_MAP.squadra] ?? '',
      qt_a: toInt(record[COLUMN_MAP.qt_a]),
      qt_i: toInt(record[COLUMN_MAP.qt_i]),
      diff: toInt(record[COLUMN_MAP.diff]),
      qt_a_m: toInt(record[COLUMN_MAP.qt_a_m]),
      qt_i_m: toInt(record[COLUMN_MAP.qt_i_m]),
      diff_m: toInt(record[COLUMN_MAP.diff_m]),
      fvm: toInt(record[COLUMN_MAP.fvm]),
      fvm_m: toInt(record[COLUMN_MAP.fvm_m]),
      // Colonna assente => si assume attivo: un listone senza la colonna
      // (es. export ufficiale grezzo) deve comunque importarsi tutto.
      is_active: (record[COLUMN_MAP.is_active] ?? '1') !== '0',
    });
  });

  return { players, skipped };
}
