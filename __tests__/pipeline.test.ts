import { createPipeline, type Stage } from '@/core/middleware/pipeline';

/**
 * La pipeline e' l'infrastruttura su cui poggiano US3-T3, US6-T2 e US8-T4.
 * Le sue garanzie vanno verificate qui, non dedotte dal comportamento della UI.
 */

describe('createPipeline', () => {
  it('esegue gli stadi nell ordine validate -> reduce -> effect', async () => {
    const calls: string[] = [];

    const stage: Stage<{ v: number }> = {
      name: 'test',
      validate: () => {
        calls.push('validate');
        return true;
      },
      reduce: () => {
        calls.push('reduce');
      },
      // L'`await` non e' decorativo: modella la vera scrittura su SQLite. Senza,
      // il corpo dell'effect girerebbe nel prologo sincrono della IIFE dentro
      // dispatch() — semantica standard di async/await, non una violazione
      // dell'invariante, che riguarda l'attesa della persistenza e non l'istante
      // in cui l'effect viene invocato.
      effect: async () => {
        await Promise.resolve();
        calls.push('effect');
      },
    };

    const result = createPipeline([stage]).dispatch({ v: 1 });

    // Al ritorno di dispatch, reduce e' gia' avvenuto ma la persistenza no:
    // e' esattamente l'invariante che tiene la UI reattiva (US8-T4).
    expect(calls).toEqual(['validate', 'reduce']);

    await result.persisted;
    expect(calls).toEqual(['validate', 'reduce', 'effect']);
  });

  it('interrompe precocemente: un validate fallito blocca reduce ed effect', async () => {
    const reduce = jest.fn();
    const effect = jest.fn();

    const result = createPipeline([
      { name: 'guard', validate: () => 'giocatore inesistente' },
      { name: 'write', reduce, effect },
    ]).dispatch({});

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('giocatore inesistente');
    expect(result.blockedBy).toBe('guard');

    await result.persisted;
    expect(reduce).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
  });

  it('valida TUTTI gli stadi prima di mutare qualsiasi stato', () => {
    const reduce = jest.fn();

    // Il primo stadio passa ma il secondo no: nessun reduce deve partire,
    // altrimenti si resterebbe con uno stato mutato a meta'.
    createPipeline([
      { name: 'primo', validate: () => true, reduce },
      { name: 'secondo', validate: () => 'stop' },
    ]).dispatch({});

    expect(reduce).not.toHaveBeenCalled();
  });

  it('non propaga alla UI il fallimento di un effect', async () => {
    const onEffectError = jest.fn();
    const secondEffect = jest.fn();

    const result = createPipeline(
      [
        {
          name: 'disco',
          effect: async () => {
            throw new Error('disk full');
          },
        },
        { name: 'altro', effect: secondEffect },
      ],
      { onEffectError }
    ).dispatch({});

    // L'azione risulta riuscita: lo stato in memoria e' corretto e la UI
    // ha gia' mostrato il risultato all'utente.
    expect(result.ok).toBe(true);

    await expect(result.persisted).resolves.toBeUndefined();
    expect(onEffectError).toHaveBeenCalledTimes(1);
    expect(onEffectError.mock.calls[0]?.[1]).toBe('disco');
    // Uno stadio rotto non deve impedire ai successivi di persistere.
    expect(secondEffect).toHaveBeenCalled();
  });

  it('accetta stadi privi di effect (filtri: solo memoria, mai I/O)', async () => {
    const reduce = jest.fn();
    const result = createPipeline([{ name: 'filtri', reduce }]).dispatch({ q: 'kva' });

    expect(result.ok).toBe(true);
    expect(reduce).toHaveBeenCalledWith({ q: 'kva' });
    await expect(result.persisted).resolves.toBeUndefined();
  });
});
