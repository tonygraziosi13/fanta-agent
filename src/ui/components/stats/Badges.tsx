import { StyleSheet, Text, View } from 'react-native';
import {
  RATING_COLORS,
  RATING_LABELS,
  RISK_COLORS,
  RISK_LABELS,
  VERDICT_COLORS,
  VERDICT_LABELS,
  type PerformanceVerdict,
  type RatingBand,
  type RiskBand,
} from '@/domain/metrics';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Indicatori colorati di sintesi (US21-3, "lettura immediata dei dati
 * predittivi").
 *
 * Etichette e colori arrivano da `domain/metrics.ts` e non sono definiti qui:
 * il significato di "rischio alto" e' una regola di dominio, e deve restare
 * identico ovunque compaia — schermata, banner, futura risposta dell'agente.
 * Questi componenti sanno solo disegnare quel che il dominio ha deciso.
 */

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { borderColor: withAlpha(color, 0.45), backgroundColor: withAlpha(color, 0.14) }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function RiskBadge({ band }: { band: RiskBand | null }) {
  if (band === null) return null;
  return <Pill label={RISK_LABELS[band]} color={RISK_COLORS[band]} />;
}

export function VerdictBadge({ verdict }: { verdict: PerformanceVerdict | null }) {
  if (verdict === null) return null;
  return <Pill label={VERDICT_LABELS[verdict]} color={VERDICT_COLORS[verdict]} />;
}

export function RatingBadge({ band }: { band: RatingBand | null }) {
  if (band === null) return null;
  return <Pill label={RATING_LABELS[band]} color={RATING_COLORS[band]} />;
}

/**
 * Il caso "nessun dato": dichiarato, mai mascherato da zero.
 *
 * Composto come un blocco e non come una riga di testo perche' spesso e' il
 * solo contenuto di una card: da solo in mezzo al bianco sembrerebbe un errore
 * di caricamento, dentro una cornice tenue si legge come quel che e' — una
 * risposta, per quanto negativa.
 */
export function MetricUnavailable({ message }: { message: string }) {
  return (
    <View style={styles.unavailableBox}>
      <Text style={styles.unavailable}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
  },
  label: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  unavailableBox: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: withAlpha(colors.surfaceRaised, 0.4),
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  unavailable: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    lineHeight: 18,
  },
});
