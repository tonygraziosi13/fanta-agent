import {
  createDefaultDraft,
  creditsPerSlot,
  rosaSize,
  rowToConfiguration,
  validateConfigurationDraft,
  type Configuration,
  type ConfigurationDraft,
} from '@/domain/configuration';

/**
 * Logica pura della configurazione d'asta: nessun DB, nessun componente.
 * Sono le regole che UI e hook condividono, quindi vanno provate una volta sola.
 */

function config(id: number, name: string, overrides: Partial<Configuration> = {}): Configuration {
  return {
    id,
    name,
    participants: 8,
    credits: 500,
    slots: { P: 3, D: 8, C: 8, A: 6 },
    isActive: false,
    createdAt: 0,
    ...overrides,
  };
}

function draft(overrides: Partial<ConfigurationDraft> = {}): ConfigurationDraft {
  return { ...createDefaultDraft(), ...overrides };
}

describe('rosaSize', () => {
  it('somma gli slot dei quattro ruoli', () => {
    expect(rosaSize({ P: 3, D: 8, C: 8, A: 6 })).toBe(25);
  });

  it('il default del fantacalcio Classic vale 25', () => {
    expect(rosaSize(createDefaultDraft().slots)).toBe(25);
  });

  it('vale zero su una rosa vuota', () => {
    expect(rosaSize({ P: 0, D: 0, C: 0, A: 0 })).toBe(0);
  });
});

describe('creditsPerSlot', () => {
  it('divide i crediti per la dimensione della rosa', () => {
    expect(creditsPerSlot({ credits: 500, slots: { P: 3, D: 8, C: 8, A: 6 } })).toBe(20);
  });

  it('non divide per zero su una rosa vuota', () => {
    expect(creditsPerSlot({ credits: 500, slots: { P: 0, D: 0, C: 0, A: 0 } })).toBe(0);
  });
});

describe('rowToConfiguration', () => {
  it('rimonta gli slot dalle colonne e converte is_active in booleano', () => {
    const result = rowToConfiguration({
      id: 7,
      name: 'Lega Amici',
      participants: 10,
      credits: 600,
      slot_p: 3,
      slot_d: 8,
      slot_c: 8,
      slot_a: 6,
      is_active: 1,
      created_at: 1234,
    });

    expect(result).toEqual({
      id: 7,
      name: 'Lega Amici',
      participants: 10,
      credits: 600,
      slots: { P: 3, D: 8, C: 8, A: 6 },
      isActive: true,
      createdAt: 1234,
    });
  });

  it('is_active a 0 diventa false', () => {
    const result = rowToConfiguration({
      id: 1,
      name: 'X',
      participants: 8,
      credits: 500,
      slot_p: 3,
      slot_d: 8,
      slot_c: 8,
      slot_a: 6,
      is_active: 0,
      created_at: 0,
    });
    expect(result.isActive).toBe(false);
  });
});

describe('validateConfigurationDraft', () => {
  it('accetta i valori di default', () => {
    expect(validateConfigurationDraft(draft(), [])).toBe(true);
  });

  it('rifiuta un nome vuoto o di soli spazi', () => {
    expect(validateConfigurationDraft(draft({ name: '   ' }), [])).toEqual(expect.any(String));
  });

  it('rifiuta un nome già usato, ignorando le maiuscole', () => {
    const existing = [config(1, 'Lega Amici')];
    expect(validateConfigurationDraft(draft({ name: 'lega amici' }), existing)).toEqual(
      expect.any(String)
    );
  });

  it('in modifica non considera duplicato il proprio nome', () => {
    const existing = [config(1, 'Lega Amici')];
    expect(validateConfigurationDraft(draft({ name: 'Lega Amici' }), existing, 1)).toBe(true);
  });

  it('rifiuta partecipanti fuori dai limiti', () => {
    expect(validateConfigurationDraft(draft({ participants: 1 }), [])).toEqual(
      expect.any(String)
    );
    expect(validateConfigurationDraft(draft({ participants: 21 }), [])).toEqual(
      expect.any(String)
    );
  });

  it('rifiuta partecipanti non numerici (campo svuotato nel form)', () => {
    expect(validateConfigurationDraft(draft({ participants: Number.NaN }), [])).toEqual(
      expect.any(String)
    );
  });

  it('rifiuta crediti nulli o negativi', () => {
    expect(validateConfigurationDraft(draft({ credits: 0 }), [])).toEqual(expect.any(String));
    expect(validateConfigurationDraft(draft({ credits: -10 }), [])).toEqual(
      expect.any(String)
    );
  });

  it('rifiuta slot negativi', () => {
    expect(
      validateConfigurationDraft(draft({ slots: { P: -1, D: 8, C: 8, A: 6 } }), [])
    ).toEqual(expect.any(String));
  });

  it('accetta un reparto vuoto purche la rosa non lo sia', () => {
    expect(
      validateConfigurationDraft(draft({ slots: { P: 0, D: 8, C: 8, A: 6 } }), [])
    ).toBe(true);
  });

  it('rifiuta una rosa senza calciatori', () => {
    expect(
      validateConfigurationDraft(draft({ slots: { P: 0, D: 0, C: 0, A: 0 } }), [])
    ).toEqual(expect.any(String));
  });
});
