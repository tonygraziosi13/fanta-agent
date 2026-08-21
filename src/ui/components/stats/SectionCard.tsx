import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, elevation, radius, spacing, typography, withAlpha } from '@/ui/theme/theme';

/**
 * Contenitore di una sezione del dettaglio (US21-2).
 *
 * Le sezioni sono "logiche e non dispersive" perche' sono blocchi visivamente
 * chiusi: l'utente in asta cerca un numero, non legge una pagina. Il titolo puo'
 * portare a destra un elemento di sintesi (una fascia di rischio, un giudizio),
 * cosi' il verdetto si legge senza aprire nulla.
 *
 * --- Il binario colorato ---
 * `accent` disegna una barra verticale di due pixel sul bordo sinistro. Serve a
 * legare la card al giocatore che si sta guardando: e' il colore del suo ruolo,
 * ripreso dalla testata. E' l'unico ornamento della card, ed e' il motivo per
 * cui il resto — bordo, ombra, fondo — resta volutamente quasi invisibile.
 *
 * Il titolo e' in maiuscoletto spaziato e non in corpo grande: deve farsi
 * trovare scorrendo, non competere coi numeri che contiene.
 */

interface Props {
  title: string;
  children: ReactNode;
  /** Badge o indicatore allineato al titolo. */
  trailing?: ReactNode;
  subtitle?: string;
  /** Colore del binario sinistro: di norma quello del ruolo del giocatore. */
  accent?: string;
}

export function SectionCard({ title, children, trailing, subtitle, accent }: Props) {
  return (
    <View style={[styles.card, elevation.card]}>
      {accent !== undefined && (
        <View pointerEvents="none" style={[styles.rail, { backgroundColor: accent }]} />
      )}

      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
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
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(colors.border, 0.9),
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: spacing.lg,
    bottom: spacing.lg,
    width: 2,
    borderTopRightRadius: radius.pill,
    borderBottomRightRadius: radius.pill,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 22,
  },
  title: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.overline.fontSize,
    fontWeight: '700',
    letterSpacing: typography.overline.letterSpacing,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    lineHeight: 17,
    marginTop: 2,
  },
  body: {
    marginTop: spacing.sm,
  },
});
