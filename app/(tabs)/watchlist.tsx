import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { selectGroupedWatchlist } from '@/state/selectors';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';
import { CategorySheet } from '@/ui/components/CategorySheet';
import { EmptyState } from '@/ui/components/EmptyState';
import { PlayerRow } from '@/ui/components/PlayerRow';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Schermata Watchlist (US5-T3, US6-T1).
 *
 * Accordion invece di tab orizzontali: le categorie sono create dall'utente e
 * possono essere molte piu' di quattro; delle tab andrebbero in overflow, delle
 * sezioni collassabili no.
 *
 * ScrollView e non FlashList: qui i record sono le decine di giocatori scelti
 * dall'utente, non 497. La virtualizzazione annidata dentro sezioni collassabili
 * costerebbe complessita' senza guadagno misurabile.
 */
export default function WatchlistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const playersById = usePlayersStore((s) => s.byId);
  const assignments = useWatchlistStore((s) => s.assignments);
  const addedAt = useWatchlistStore((s) => s.addedAt);
  const categories = useCategoriesStore((s) => s.categories);

  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [sheetPlayerId, setSheetPlayerId] = useState<number | null>(null);

  const groups = useMemo(
    () => selectGroupedWatchlist(playersById, assignments, addedAt, categories),
    [playersById, assignments, addedAt, categories]
  );

  const total = groups.reduce((sum, g) => sum + g.count, 0);

  const handlePressAssign = useCallback((playerId: number) => {
    // US6-T1: dalla Watchlist il badge riapre il menu, da cui si sposta o si rimuove.
    setSheetPlayerId(playerId);
  }, []);

  // US21-1: il tap sul giocatore apre il dettaglio anche da qui.
  const handlePressDetail = useCallback(
    (playerId: number) => router.push(`/player/${playerId}`),
    [router]
  );

  const closeSheet = useCallback(() => setSheetPlayerId(null), []);

  const toggle = (categoryId: number) =>
    setCollapsed((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
        <View style={styles.toolbar}>
          <Text style={styles.total}>
            {total} {total === 1 ? 'giocatore salvato' : 'giocatori salvati'}
          </Text>
          <Link href="/categories" asChild>
            <TouchableOpacity style={styles.manageButton} accessibilityRole="button">
              <Text style={styles.manageLabel}>Gestisci categorie</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {total === 0 ? (
          <EmptyState
            icon="⭐"
            title="Watchlist vuota"
            message="Vai sul Listone e tocca il + accanto a un calciatore per iniziare a costruire la tua strategia."
          />
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed[group.category.id] ?? false;

            return (
              <View key={group.category.id} style={styles.section}>
                <TouchableOpacity
                  onPress={() => toggle(group.category.id)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !isCollapsed }}
                  style={styles.sectionHeader}
                >
                  <View style={[styles.dot, { backgroundColor: group.category.color }]} />
                  <Text style={styles.sectionTitle}>{group.category.name}</Text>
                  {/* US5: conteggio esatto per ogni gruppo, sempre visibile. */}
                  <View style={[styles.countPill, { borderColor: group.category.color }]}>
                    <Text style={styles.countText}>{group.count}</Text>
                  </View>
                  <Text style={styles.chevron}>{isCollapsed ? '▸' : '▾'}</Text>
                </TouchableOpacity>

                {!isCollapsed &&
                  (group.count === 0 ? (
                    <Text style={styles.emptyCategory}>Nessun giocatore in questa categoria.</Text>
                  ) : (
                    group.players.map((player) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        onPressAssign={handlePressAssign}
                        onPress={handlePressDetail}
                      />
                    ))
                  ))}
              </View>
            );
          })
        )}
      </ScrollView>

      <CategorySheet playerId={sheetPlayerId} onClose={closeSheet} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  total: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
  },
  manageButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  manageLabel: {
    color: colors.accent,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  section: {
    marginBottom: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  sectionTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
  },
  countPill: {
    minWidth: 26,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
  },
  countText: {
    color: colors.textPrimary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
  },
  emptyCategory: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontStyle: 'italic',
  },
});
