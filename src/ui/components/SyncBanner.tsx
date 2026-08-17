import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { selectSyncNotice, useSyncStore } from '@/state/useSyncStore';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Esito della sincronizzazione in background (US20-2).
 *
 * Deliberatamente non modale e non bloccante: il sync avviene mentre l'utente
 * sta gia' lavorando, e interromperlo con un dialogo per dirgli che i dati sono
 * migliorati sarebbe un peggioramento netto. Una striscia in fondo, che si
 * chiude con un tocco.
 *
 * Non compare mai per dire "sei aggiornato": e' il caso normale a ogni avvio, e
 * annunciarlo trasformerebbe un'informazione utile in rumore ignorato.
 */
export function SyncBanner() {
  const message = useSyncStore(selectSyncNotice);
  const dismiss = useSyncStore((s) => s.dismissNotice);
  const failed = useSyncStore((s) => s.lastOutcome?.status === 'failed');

  if (message === null) return null;

  return (
    <View style={[styles.banner, failed && styles.bannerError]}>
      <Text style={styles.text}>{message}</Text>
      <TouchableOpacity
        onPress={dismiss}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Chiudi la notifica"
      >
        <Text style={styles.close}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    // Sopra la tab bar, non sopra i suoi pulsanti: il banner e' informativo e
    // non deve coprire la navigazione mentre l'utente lo ignora.
    bottom: 84,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerError: {
    borderColor: colors.border,
  },
  text: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    lineHeight: 17,
  },
  close: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
});
