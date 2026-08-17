import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseMantraRoles, ROLE_LABELS } from '@/domain/roles';
import {
  describeMissingData,
  selectAnalytics,
  selectEconomics,
  selectInjuries,
  selectPerformance,
} from '@/state/statsSelectors';
import { useCategory } from '@/state/useCategoriesStore';
import { usePlayerStats, usePlayerStatsStore } from '@/state/usePlayerStatsStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useAssignedCategoryId } from '@/state/useWatchlistStore';
import { CategorySheet } from '@/ui/components/CategorySheet';
import { EmptyState } from '@/ui/components/EmptyState';
import { RoleBadge } from '@/ui/components/RoleBadge';
import { MetricUnavailable, RiskBadge, VerdictBadge } from '@/ui/components/stats/Badges';
import { HeatmapGrid } from '@/ui/components/stats/HeatmapGrid';
import { SectionCard } from '@/ui/components/stats/SectionCard';
import { StatBar } from '@/ui/components/stats/StatBar';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Dettaglio calciatore (US21).
 *
 * Rotta dinamica fuori dalle tab: si arriva qui toccando una riga, sia dal
 * Listone sia dalla Watchlist, e si torna indietro con il gesto di sistema. Non
 * e' una tab perche' non e' una destinazione, e' un approfondimento.
 *
 * L'anagrafica arriva dal listone gia' in RAM (`byId`, O(1)); le metriche si
 * leggono da SQLite al montaggio, una riga sola (US21-T2). Nessuna sezione
 * inventa valori: dove la fonte non copre il giocatore compare il perche'.
 *
 * Il pulsante di assegnazione resta disponibile anche da qui: e' il momento in
 * cui l'utente ha appena visto i numeri e decide. Riusa `CategorySheet`, quindi
 * l'azione passa dalla solita pipeline ed e' identica a quella del listone.
 */
export default function PlayerDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const playerId = Number(params.id);

  const player = usePlayersStore((s) => (Number.isFinite(playerId) ? s.byId[playerId] : undefined));
  const stats = usePlayerStats(playerId);
  const loading = usePlayerStatsStore((s) => s.loading[playerId] === true);
  const load = usePlayerStatsStore((s) => s.load);

  const categoryId = useAssignedCategoryId(playerId);
  const category = useCategory(categoryId);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (Number.isFinite(playerId)) void load(playerId);
  }, [playerId, load]);

  const sections = useMemo(
    () => ({
      economics: player ? selectEconomics(player) : null,
      performance: selectPerformance(stats),
      analytics: selectAnalytics(stats),
      injuries: selectInjuries(stats),
    }),
    [player, stats]
  );

  if (!player) {
    return (
      <>
        <Stack.Screen options={{ title: 'Calciatore' }} />
        <View style={styles.container}>
          <EmptyState
            title="Calciatore non trovato"
            message="Il calciatore non è più presente nel listone."
          />
        </View>
      </>
    );
  }

  const mantra = parseMantraRoles(player.rm);
  const { economics, performance, analytics, injuries } = sections;

  return (
    <>
      <Stack.Screen options={{ title: player.nome }} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
      >
        {/* --- Intestazione: chi è, e in che categoria l'ho messo --- */}
        <View style={styles.hero}>
          <RoleBadge role={player.r} />
          <View style={styles.heroInfo}>
            <Text style={styles.name}>{player.nome}</Text>
            <Text style={styles.meta}>
              {player.squadra} · {ROLE_LABELS[player.r]}
              {mantra.length > 0 ? ` · ${mantra.join('/')}` : ''}
            </Text>
            {!player.is_active && <Text style={styles.ceduto}>Non più in Serie A</Text>}
          </View>

          <TouchableOpacity
            onPress={() => setSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              category ? `Categoria ${category.name}. Tocca per modificare.` : 'Assegna a una categoria'
            }
            style={[
              styles.assign,
              category
                ? { backgroundColor: category.color, borderColor: category.color }
                : { borderColor: colors.border },
            ]}
          >
            <Text style={[styles.assignLabel, category ? styles.assignLabelOn : undefined]}>
              {category ? category.name : '+ Categoria'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* --- Nessuna metrica: lo si dice una volta, in cima --- */}
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
        {!loading && stats === undefined && (
          <SectionCard title="Statistiche">
            <MetricUnavailable message={describeMissingData(undefined)} />
          </SectionCard>
        )}

        {economics && (
          <SectionCard title={economics.title}>
            {economics.lines.map((line) => (
              <StatBar key={line.label} {...line} />
            ))}
          </SectionCard>
        )}

        {performance.available && (
          <SectionCard
            title={performance.title}
            subtitle={stats?.season ? `Stagione ${stats.season}` : undefined}
          >
            {performance.lines.map((line) => (
              <StatBar key={line.label} {...line} />
            ))}
          </SectionCard>
        )}

        {analytics.available && (
          <SectionCard
            title={analytics.title}
            trailing={<VerdictBadge verdict={analytics.goalVerdict} />}
            subtitle={
              analytics.goalVerdict === 'over'
                ? 'Ha segnato più di quanto le occasioni suggerissero: rendimento difficile da ripetere.'
                : analytics.goalVerdict === 'under'
                  ? 'Ha segnato meno delle occasioni create: margine di recupero.'
                  : undefined
            }
          >
            {analytics.lines.map((line) => (
              <StatBar key={line.label} {...line} />
            ))}
          </SectionCard>
        )}

        {injuries.available && (
          <SectionCard title={injuries.title} trailing={<RiskBadge band={injuries.band} />}>
            {injuries.lines.map((line) => (
              <StatBar key={line.label} {...line} />
            ))}

            {stats !== undefined && stats.injuries.history.length > 0 && (
              <View style={styles.history}>
                {stats.injuries.history.slice(0, 6).map((spell, index) => (
                  <View key={`${spell.season}-${index}`} style={styles.spell}>
                    <Text style={styles.spellSeason}>{spell.season}</Text>
                    <Text style={styles.spellType} numberOfLines={1}>
                      {spell.type}
                    </Text>
                    <Text style={styles.spellDays}>
                      {spell.days !== null ? `${spell.days} gg` : '—'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </SectionCard>
        )}

        {stats?.heatmap != null && (
          <SectionCard title="Zone di campo" subtitle="Presenza media in campo nella stagione">
            <HeatmapGrid heatmap={stats.heatmap} />
          </SectionCard>
        )}
      </ScrollView>

      <CategorySheet playerId={sheetOpen ? playerId : null} onClose={() => setSheetOpen(false)} />
    </>
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
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroInfo: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.textPrimary,
    fontSize: typography.title.fontSize,
    fontWeight: '700',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
  },
  ceduto: {
    color: colors.danger,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  assign: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 130,
  },
  assignLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  assignLabelOn: {
    color: '#0B1220',
  },
  loading: {
    paddingVertical: spacing.lg,
  },
  history: {
    marginTop: spacing.sm,
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  spell: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  spellSeason: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
    width: 44,
    fontVariant: ['tabular-nums'],
  },
  spellType: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
  },
  spellDays: {
    color: colors.textPrimary,
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
