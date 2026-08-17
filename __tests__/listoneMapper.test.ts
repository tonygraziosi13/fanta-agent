import fs from 'fs';
import path from 'path';
import { parseCsvText } from '@/core/parsing/csvParser';
import { mapRecordsToPlayers } from '@/core/parsing/listoneMapper';
import { parseMantraRoles } from '@/domain/roles';

/**
 * Questi test girano sul CSV reale in assets/data, non su una fixture inventata.
 * E' voluto: il rischio concreto e' che il tracciato ufficiale cambi e l'import
 * degradi in silenzio. Un test su dati finti non lo intercetterebbe mai.
 */
const CSV_PATH = path.join(__dirname, '..', 'assets', 'data', 'listone.csv');

describe('parsing del listone', () => {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parseCsvText(text);
  const { players, skipped } = mapRecordsToPlayers(records);

  it('parsa ogni riga senza scartarne nessuna', () => {
    expect(skipped).toEqual([]);
    expect(players).toHaveLength(records.length);
  });

  it('importa i 497 giocatori attivi e gli 8 ceduti', () => {
    const active = players.filter((p) => p.is_active);
    const inactive = players.filter((p) => !p.is_active);

    expect(active).toHaveLength(497);
    expect(inactive).toHaveLength(8);
  });

  it('mappa i campi numerici come numeri, non come stringhe', () => {
    const svilar = players.find((p) => p.nome === 'Svilar');

    expect(svilar).toBeDefined();
    expect(svilar).toMatchObject({
      id: 5841,
      r: 'P',
      rm: 'Por',
      squadra: 'Roma',
      qt_a: 18,
      fvm: 65,
      is_active: true,
    });
    expect(typeof svilar!.qt_a).toBe('number');
  });

  it('assegna a ogni giocatore un ruolo Classic valido', () => {
    const roles = new Set(players.map((p) => p.r));
    expect([...roles].sort()).toEqual(['A', 'C', 'D', 'P']);
  });

  it('non produce id duplicati (la chiave primaria regge l upsert)', () => {
    const ids = new Set(players.map((p) => p.id));
    expect(ids.size).toBe(players.length);
  });

  it('normalizza i ruoli Mantra multi-valore', () => {
    expect(parseMantraRoles('Ds;Dc')).toEqual(['Ds', 'Dc']);
    expect(parseMantraRoles('B;Dd;E')).toEqual(['B', 'Dd', 'E']);
    expect(parseMantraRoles('Por')).toEqual(['Por']);
    expect(parseMantraRoles(null)).toEqual([]);
    expect(parseMantraRoles('')).toEqual([]);
  });
});

describe('robustezza del parser', () => {
  it('gestisce i campi quotati contenenti virgole', () => {
    // Scenario per cui esiste PapaParse: oggi non si verifica, ma un
    // aggiornamento del listone puo' introdurlo in qualsiasi momento.
    const csv = 'Id,R,RM,Nome,Squadra,IsActive\n1,A,Pc,"Rossi, Jr.",Milan,1';
    const { players, skipped } = mapRecordsToPlayers(parseCsvText(csv));

    expect(skipped).toEqual([]);
    expect(players[0]?.nome).toBe('Rossi, Jr.');
  });

  it('scarta le righe corrotte senza far fallire l intero import', () => {
    const csv = [
      'Id,R,RM,Nome,Squadra,IsActive',
      '1,A,Pc,Valido,Milan,1',
      ',A,Pc,SenzaId,Milan,1',
      '3,X,Pc,RuoloIgnoto,Milan,1',
      '4,C,M,,Milan,1',
    ].join('\n');

    const { players, skipped } = mapRecordsToPlayers(parseCsvText(csv));

    expect(players).toHaveLength(1);
    expect(players[0]?.nome).toBe('Valido');
    expect(skipped).toHaveLength(3);
  });

  it('assume attivo il giocatore quando manca la colonna IsActive', () => {
    const csv = 'Id,R,RM,Nome,Squadra\n1,A,Pc,Test,Milan';
    const { players } = mapRecordsToPlayers(parseCsvText(csv));
    expect(players[0]?.is_active).toBe(true);
  });
});
