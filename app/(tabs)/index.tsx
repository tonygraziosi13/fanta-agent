import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import {
  activateConfiguration,
  removeConfiguration,
} from '@/core/middleware/hooks/configurationHook';
import { countPlayersInConfiguration } from '@/core/repositories/configurationsRepository';
import { countWatchlistByConfiguration } from '@/core/repositories/watchlistRepository';
import { creditsPerSlot, rosaSize, type Configuration } from '@/domain/configuration';
import { CLASSIC_ROLES, ROLE_COLORS } from '@/domain/roles';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Home: riepilogo delle configurazioni d'asta.
 *
 * E' la schermata principale perche' e' il contesto di tutto il resto: quanti
 * crediti si hanno e che rosa si deve riempire viene prima di quale giocatore
 * mettere in lista. Listone e Watchlist restano a un tap, sulle proprie tab.
 *
 * Nessuna lista virtualizzata: le configurazioni sono poche unita', una
 * ScrollView costa meno di FlashList in memoria e in complessita'.
 */
export default function HomeScreen() {
  const configurations = useConfigurationsStore((s) => s.configurations);
  const activeId = useConfigurationsStore((s) => s.activeId);
  const router = useRouter();

  /**
   * I conteggi per configurazione non stanno nello store: solo la watchlist
   * attiva vive in RAM, le altre no. Una singola GROUP BY al focus della
   * schermata costa meno che tenere in memoria tutte le leghe.
   */
  const [counts, setCounts] = useState<Record<number, number>>({});

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void countWatchlistByConfiguration().then((next) => {
        if (!cancelled) setCounts(next);
      });
      return () => {
        cancelled = true;
      };
    }, [configurations])
  );

  const handleDelete = async (config: Configuration) => {
    const affected = await countPlayersInConfiguration(config.id);
    const isLast = configurations.length === 1;

    const lines = [
      affected === 0
        ? `Eliminare la configurazione "${config.name}"?`
        : `Eliminando "${config.name}" perderai anche ${affected} ` +
          `${affected === 1 ? 'giocatore' : 'giocatori'} dalla sua watchlist. ` +
          'I calciatori restano nel listone.',
    ];
    if (isLast) lines.push('È l\'ultima: dovrai creare una nuova configurazione per continuare.');

    Alert.alert('Eliminare configurazione', lines.join('\n\n'), [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina',
        style: 'destructive',
        onPress: async () => {
          const result = await removeConfiguration(config.id);
          if (!result.ok) Alert.alert('Impossibile eliminare', result.reason);
        },
      },
    ]);
  };

  const handleActivate = async (config: Configuration) => {
    const result = await activateConfiguration(config.id);
    if (!result.ok) Alert.alert('Impossibile attivare', result.reason);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>Le mie configurazioni ({configurations.length})</Text>

      {configurations.map((config) => {
        const isActive = config.id === activeId;
        const total = rosaSize(config.slots);
        const inWatchlist = counts[config.id] ?? 0;

        return (
          <View key={config.id} style={[styles.card, isActive && styles.cardActive]}>
            <View style={styles.rowHead}>
              <Text style={styles.name}>{config.name}</Text>
              {isActive && <Text style={styles.badge}>ATTIVA</Text>}
            </View>

            <View style={styles.stats}>
              <Stat value={String(config.participants)} label="partecipanti" />
              <Stat value={String(config.credits)} label="crediti" />
              <Stat value={String(total)} label="in rosa" />
              <Stat
                value={creditsPerSlot(config).toFixed(1)}
                label="crediti/slot"
              />
            </View>

            <View style={styles.slots}>
              {CLASSIC_ROLES.map((role) => (
                <View key={role} style={styles.slotChip}>
                  <View style={[styles.roleDot, { backgroundColor: ROLE_COLORS[role] }]} />
                  <Text style={styles.slotText}>
                    {role} {config.slots[role]}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={styles.watchlistLine}>
              {inWatchlist === 0
                ? 'Nessun giocatore in watchlist'
                : `${inWatchlist} ${inWatchlist === 1 ? 'giocatore' : 'giocatori'} in watchlist`}
            </Text>

            <View style={styles.actions}>
              {!isActive && (
                <ActionButton label="Attiva" onPress={() => handleActivate(config)} />
              )}
              <ActionButton
                label="Modifica"
                onPress={() => router.push(`/configuration?id=${config.id}`)}
              />
              <ActionButton
                label="Elimina"
                destructive
                onPress={() => handleDelete(config)}
              />
            </View>
          </View>
        );
      })}

      <Link href="/configuration" asChild>
        <TouchableOpacity style={styles.primaryButton} accessibilityRole="button">
          <Text style={styles.primaryLabel}>+ Nuova configurazione</Text>
        </TouchableOpacity>
      </Link>

      <Text style={styles.footnote}>
        La watchlist è separata per configurazione: quella che vedi nelle altre schede è
        sempre quella attiva. Le categorie invece sono condivise fra tutte le leghe.
      </Text>
    </ScrollView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  destructive,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.actionButton, destructive === true && { borderColor: colors.danger }]}
    >
      <Text style={[styles.actionLabel, destructive === true && { color: colors.danger }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardActive: {
    borderWidth: 1,
    borderColor: colors.accent,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
  },
  badge: {
    color: '#0B1220',
    backgroundColor: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  stat: {
    gap: 2,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
  },
  slots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  slotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  roleDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  slotText: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  watchlistLine: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  primaryButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  primaryLabel: {
    color: '#0B1220',
    fontSize: typography.body.fontSize,
    fontWeight: '800',
  },
  footnote: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
});
