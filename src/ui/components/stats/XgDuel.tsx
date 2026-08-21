import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  VERDICT_COLORS,
  formatMetric,
  type PerformanceVerdict,
} from '@/domain/metrics';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Realizzato contro atteso, sulla stessa traccia.
 *
 * --- Perche' questo grafico e non un altro ---
 * E' l'unico posto della scheda in cui un disegno dice qualcosa che il numero
 * da solo non dice. "8 gol" e "xG 5.2" sono due valori; messi sulla stessa
 * scala diventano una domanda con risposta: quel rendimento e' ripetibile?
 * Chi segna molto piu' delle occasioni che si costruisce tende a regredire
 * l'anno dopo, ed e' il malus implicito che un fantallenatore deve vedere
 * *prima* di rilanciare.
 *
 * Le due barre condividono il denominatore (il massimo fra i due valori), o il
 * confronto non significherebbe niente: sono due misure della stessa cosa e
 * devono stare sullo stesso righello.
 *
 * Il colore viene dal verdetto in `domain/metrics.ts` e non da qui: verde e
 * giallo significano "sostenibile" e "difficile da ripetere", ed e' una regola
 * di dominio che deve dire la stessa cosa ovunque compaia.
 *
 * Senza uno dei due valori il componente non si disegna: mezza comparazione
 * non e' una comparazione, e una barra sola comunicherebbe una certezza che
 * non abbiamo.
 */

interface Props {
  /** Realizzato: gol, oppure assist. */
  actual: number | null;
  /** Atteso: xG, oppure xA. */
  expected: number | null;
  actualLabel: string;
  expectedLabel: string;
  verdict: PerformanceVerdict | null;
}

function XgDuelComponent({ actual, expected, actualLabel, expectedLabel, verdict }: Props) {
  if (actual === null || expected === null) return null;

  const scale = Math.max(actual, expected, 0.1);
  const tone = verdict === null ? colors.accent : VERDICT_COLORS[verdict];
  const delta = actual - expected;
  const deltaLabel = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatMetric(Math.abs(delta), 1)}`;

  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={`${actualLabel} ${formatMetric(actual, 0)}, ${expectedLabel} ${formatMetric(expected, 2)}. Scarto ${deltaLabel}.`}
    >
      <Row
        label={actualLabel}
        value={formatMetric(actual, 0)}
        ratio={actual / scale}
        color={tone}
        emphasis
      />
      <Row
        label={expectedLabel}
        value={formatMetric(expected, 2)}
        ratio={expected / scale}
        color={colors.textMuted}
      />

      <View style={styles.deltaRow}>
        <View style={[styles.deltaChip, { backgroundColor: withAlpha(tone, 0.16) }]}>
          <Text style={[styles.deltaValue, { color: tone }]}>{deltaLabel}</Text>
        </View>
        <Text style={styles.deltaCaption} numberOfLines={2}>
          {delta > 0
            ? 'in piu’ di quanto le occasioni valessero'
            : delta < 0
              ? 'in meno di quanto le occasioni valessero'
              : 'esattamente quanto le occasioni valevano'}
        </Text>
      </View>
    </View>
  );
}

function Row({
  label,
  value,
  ratio,
  color,
  emphasis,
}: {
  label: string;
  value: string;
  ratio: number;
  color: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.rowTrack}>
        <View
          style={[
            styles.rowFill,
            { width: `${Math.round(Math.min(ratio, 1) * 100)}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={[styles.rowValue, emphasis && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLabel: {
    width: 74,
    color: colors.textSecondary,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  rowTrack: {
    flex: 1,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: withAlpha(colors.surfaceRaised, 0.8),
    overflow: 'hidden',
  },
  rowFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  rowValue: {
    minWidth: 44,
    textAlign: 'right',
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
    fontVariant: ['tabular-nums'],
  },
  rowValueStrong: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  deltaChip: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  deltaValue: {
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  deltaCaption: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
});

export const XgDuel = memo(XgDuelComponent);
