import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { InjurySpell } from '@/domain/playerStats';
import { colors, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Storico infortuni come sequenza, non come tabella.
 *
 * --- Cosa deve trasmettere ---
 * Non il dettaglio clinico, ma la *forma* del rischio: tre stop da cinque
 * giorni non sono un crociato, e un totale di 180 giorni non distingue i due
 * casi. La colonna di pallini dimensionati sulla gravita' rende quella
 * differenza leggibile prima di aver letto un solo nome di infortunio.
 *
 * La gravita' si misura in giorni, con tre scalini: fino a due settimane e' un
 * contrattempo, fino a due mesi e' un infortunio serio, oltre e' una stagione
 * compromessa. Gli stessi tre colori delle fasce di rischio, cosi' il pallino e
 * il badge in testa alla card si spiegano a vicenda.
 */

const SHORT_DAYS = 14;
const LONG_DAYS = 60;

function severity(days: number | null): { color: string; size: number } {
  if (days === null) return { color: colors.textMuted, size: 6 };
  if (days > LONG_DAYS) return { color: '#EF4444', size: 12 };
  if (days > SHORT_DAYS) return { color: '#F5C518', size: 9 };
  return { color: '#22C55E', size: 6 };
}

interface Props {
  spells: InjurySpell[];
  /** Quanti episodi mostrare prima di riassumere il resto. */
  limit?: number;
}

function InjuryTimelineComponent({ spells, limit = 6 }: Props) {
  if (spells.length === 0) return null;

  const shown = spells.slice(0, limit);
  const hidden = spells.length - shown.length;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Episodi registrati</Text>

      {shown.map((spell, index) => {
        const { color, size } = severity(spell.days);
        const last = index === shown.length - 1 && hidden === 0;

        return (
          <View key={`${spell.season}-${spell.type}-${index}`} style={styles.row}>
            {/* La colonna sinistra: pallino di gravita' e filo di continuita'. */}
            <View style={styles.rail}>
              <View style={[styles.dot, { width: size, height: size, backgroundColor: color }]} />
              {!last && <View style={styles.thread} />}
            </View>

            <Text style={styles.season}>{spell.season}</Text>
            <Text style={styles.type} numberOfLines={1}>
              {spell.type}
            </Text>
            <Text style={[styles.days, spell.days === null && styles.daysMissing]}>
              {spell.days !== null ? `${spell.days} gg` : '—'}
            </Text>
          </View>
        );
      })}

      {hidden > 0 && (
        <Text style={styles.more}>
          e altri {hidden} episodi meno recenti
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  heading: {
    color: colors.textMuted,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 28,
  },
  rail: {
    width: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  dot: {
    borderRadius: radius.pill,
  },
  thread: {
    position: 'absolute',
    top: '50%',
    bottom: -6,
    width: 1,
    backgroundColor: withAlpha(colors.border, 0.9),
  },
  season: {
    width: 42,
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontVariant: ['tabular-nums'],
  },
  type: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
  },
  days: {
    color: colors.textPrimary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  daysMissing: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  more: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 11,
  },
});

export const InjuryTimeline = memo(InjuryTimelineComponent);
