import { StyleSheet, Text, View } from 'react-native';
import type { Heatmap } from '@/domain/playerStats';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Heatmap posizionale (US21-3).
 *
 * La pipeline consegna una griglia di intensita' gia' normalizzate 0..1: qui non
 * si aggrega nulla, si colora. E' la stessa divisione del lavoro applicata
 * all'indice di rischio — i calcoli stanno a monte (US19-3), il dispositivo
 * disegna.
 *
 * Niente SVG e niente librerie: una griglia di `View` con opacita' variabile
 * ottiene lo stesso risultato e non aggiunge dipendenze native.
 *
 * Orientamento: campo verticale, area d'attacco in alto — come sono disegnate
 * le formazioni sulle app di fantacalcio, quindi come l'utente se le aspetta.
 */

interface Props {
  heatmap: Heatmap;
}

export function HeatmapGrid({ heatmap }: Props) {
  const { rows, cols, cells } = heatmap;

  return (
    <View style={styles.container}>
      <Text style={styles.caption}>Attacco</Text>

      <View style={styles.pitch}>
        {/* Linea di meta' campo: senza un riferimento, la griglia e' astratta. */}
        <View style={styles.halfway} />

        {Array.from({ length: rows }, (_, row) => (
          <View key={row} style={styles.row}>
            {Array.from({ length: cols }, (_, col) => {
              const intensity = cells[row * cols + col] ?? 0;
              return (
                <View
                  key={col}
                  style={[
                    styles.cell,
                    // Una soglia minima di opacita' solo dove c'e' davvero
                    // presenza: le celle a zero devono restare campo vuoto.
                    intensity > 0.02 && {
                      backgroundColor: colors.accent,
                      opacity: 0.12 + intensity * 0.78,
                    },
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>

      <Text style={styles.caption}>Difesa</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
    alignItems: 'center',
  },
  pitch: {
    width: '100%',
    aspectRatio: 0.72,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  halfway: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    margin: 1,
    borderRadius: 2,
  },
  caption: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
  },
});
