import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Riga metrica con micro-barra di riempimento (US21-T3).
 *
 * La barra e' un `View` con larghezza percentuale, non una libreria grafica:
 * un rettangolo colorato non giustifica una dipendenza nativa in piu' — e
 * `@shopify/flash-list` a parte, questo progetto ne ha volutamente poche.
 *
 * Il valore numerico resta sempre scritto accanto: la barra aiuta il confronto
 * a colpo d'occhio, ma in asta si decide sul numero.
 *
 * --- Le due forme del "niente" ---
 * Quando il dato manca la barra **sparisce del tutto** invece di mostrarsi
 * vuota: una traccia a zero si legge come "rendimento nullo", che e' un'altra
 * cosa. Al suo posto resta la traccia spenta, che tiene l'altezza della riga
 * costante — cosi' due giocatori con copertura diversa producono liste alte
 * uguale e restano confrontabili scorrendo.
 */

interface Props {
  label: string;
  value: string;
  /** 0..1, oppure null/undefined per non disegnare il riempimento. */
  ratio?: number | null;
  hint?: string;
  color?: string;
}

function StatBarComponent({ label, value, ratio, hint, color = colors.accent }: Props) {
  const missing = value === '—';
  const showFill = ratio !== null && ratio !== undefined && !missing;
  const showTrack = ratio !== null && ratio !== undefined;

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={missing ? `${label}: dato non disponibile` : `${label}: ${value}`}
    >
      <View style={styles.header}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.value, missing && styles.valueMissing]}>
          {missing ? 'non disponibile' : value}
        </Text>
      </View>

      {showTrack && (
        <View style={styles.track}>
          {showFill && (
            <View
              style={[
                styles.fill,
                { width: `${Math.round(ratio * 100)}%`, backgroundColor: color },
              ]}
            />
          )}
        </View>
      )}

      {hint !== undefined && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  label: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
  },
  value: {
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  /**
   * "non disponibile" per esteso invece del trattino: nella riga c'e' spazio,
   * e detto a parole non si confonde con un valore. Corsivo e tenue perche'
   * non e' un dato — e' una nota sul dato.
   */
  valueMissing: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: '400',
    fontStyle: 'italic',
  },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.surfaceRaised, 0.8),
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
});

export const StatBar = memo(StatBarComponent);
