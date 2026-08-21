import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ROLE_COLORS, CLASSIC_ROLES, type ClassicRole } from '@/domain/roles';
import { colors, radius, spacing, withAlpha } from '@/ui/theme/theme';

/**
 * La rosa come griglia di caselle, una per slot.
 *
 * --- Perche' proprio questa forma ---
 * E' l'oggetto che ogni fantallenatore ha davanti su carta: venticinque
 * caselle che si riempiono in tre ore. Non e' una metafora scelta per
 * decorare — e' il modello mentale con cui si sta gia' ragionando al tavolo, e
 * riprodurlo significa che nessuno deve tradurre niente.
 *
 * Un numero ("13/25") direbbe lo stesso totale, ma non direbbe *quale reparto*
 * e' indietro. La griglia lo dice senza leggere: tre caselle gialle vuote in
 * cima sono un portiere che manca, e si vedono da un metro di distanza.
 *
 * I colori sono quelli di `domain/roles.ts` — P giallo, D verde, C blu, A rosso
 * e' un criterio di accettazione, non una scelta grafica.
 */

interface Props {
  /** Slot ancora liberi per ruolo. */
  liberi: Record<ClassicRole, number>;
  /** Slot totali per ruolo: la differenza sono le caselle gia' riempite. */
  totali: Record<ClassicRole, number>;
  /** `compact` per le righe del tavolo, `full` per la propria rosa. */
  size?: 'compact' | 'full';
}

function SlotGridComponent({ liberi, totali, size = 'full' }: Props) {
  const compatta = size === 'compact';
  const lato = compatta ? 6 : 14;
  const gap = compatta ? 2 : 4;

  return (
    <View
      style={[styles.container, { gap: compatta ? spacing.sm : spacing.md }]}
      accessibilityRole="text"
      accessibilityLabel={descrivi(liberi, totali)}
    >
      {CLASSIC_ROLES.map((ruolo) => {
        const totale = totali[ruolo];
        const libero = liberi[ruolo];
        const presi = Math.max(totale - libero, 0);

        return (
          <View key={ruolo} style={[styles.reparto, { gap }]}>
            {Array.from({ length: totale }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.cella,
                  { width: lato, height: lato, borderRadius: compatta ? 1.5 : radius.sm },
                  i < presi
                    ? { backgroundColor: ROLE_COLORS[ruolo] }
                    : {
                        // Il vuoto e' tinto del suo ruolo ma quasi spento: si
                        // capisce *quale* casella manca senza che il vuoto
                        // gridi quanto il pieno.
                        backgroundColor: withAlpha(ROLE_COLORS[ruolo], 0.12),
                        borderWidth: compatta ? 0 : StyleSheet.hairlineWidth,
                        borderColor: withAlpha(ROLE_COLORS[ruolo], 0.35),
                      },
                ]}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function descrivi(
  liberi: Record<ClassicRole, number>,
  totali: Record<ClassicRole, number>
): string {
  return CLASSIC_ROLES.map(
    (r) => `${r}: ${totali[r] - liberi[r]} di ${totali[r]}`
  ).join(', ');
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  reparto: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cella: {
    backgroundColor: colors.surfaceRaised,
  },
});

export const SlotGrid = memo(SlotGridComponent);
