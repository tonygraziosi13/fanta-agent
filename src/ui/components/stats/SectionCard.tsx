import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Contenitore di una sezione del dettaglio (US21-2).
 *
 * Le sezioni sono "logiche e non dispersive" perche' sono blocchi visivamente
 * chiusi: l'utente in asta cerca un numero, non legge una pagina. Il titolo puo'
 * portare a destra un elemento di sintesi (una fascia di rischio, un giudizio),
 * cosi' il verdetto si legge senza aprire nulla.
 */

interface Props {
  title: string;
  children: ReactNode;
  /** Badge o indicatore allineato al titolo. */
  trailing?: ReactNode;
  subtitle?: string;
}

export function SectionCard({ title, children, trailing, subtitle }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {trailing}
      </View>
      {subtitle !== undefined && <Text style={styles.subtitle}>{subtitle}</Text>}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
  },
  body: {
    marginTop: spacing.xs,
  },
});
