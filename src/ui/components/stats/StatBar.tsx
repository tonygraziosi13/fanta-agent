import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Riga metrica con barra di riempimento (US21-T3).
 *
 * La barra e' un `View` con larghezza percentuale, non una libreria grafica:
 * un rettangolo colorato non giustifica una dipendenza nativa in piu' — e
 * `@shopify/flash-list` a parte, questo progetto ne ha volutamente poche.
 *
 * Il valore numerico resta sempre scritto accanto: la barra aiuta il confronto
 * a colpo d'occhio, ma in asta si decide sul numero. Quando il dato manca la
 * barra sparisce del tutto invece di mostrarsi vuota — una barra a zero si
 * legge come "rendimento nullo", che e' un'altra cosa.
 */

interface Props {
  label: string;
  value: string;
  /** 0..1, oppure null/undefined per non disegnare la barra. */
  ratio?: number | null;
  hint?: string;
  color?: string;
}

function StatBarComponent({ label, value, ratio, hint, color = colors.accent }: Props) {
  const showBar = ratio !== null && ratio !== undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.value, value === '—' && styles.valueMissing]}>{value}</Text>
      </View>

      {showBar && (
        <View style={styles.track}>
          <View
            style={[styles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: color }]}
          />
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
  valueMissing: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
  },
});

export const StatBar = memo(StatBarComponent);
