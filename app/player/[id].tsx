import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROLE_COLORS } from '@/domain/roles';
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
import {
  MetricUnavailable,
  RatingBadge,
  RiskBadge,
  VerdictBadge,
} from '@/ui/components/stats/Badges';
import { InjuryTimeline } from '@/ui/components/stats/InjuryTimeline';
import { PlayerHero } from '@/ui/components/stats/PlayerHero';
import { SectionCard } from '@/ui/components/stats/SectionCard';
import { StatBar } from '@/ui/components/stats/StatBar';
import { StatTile } from '@/ui/components/stats/StatTile';
import { XgDuel } from '@/ui/components/stats/XgDuel';
import { colors, spacing, typography } from '@/ui/theme/theme';

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
 * --- Come e' composta, e perche' cosi' ---
 * Il momento d'uso e' un'asta dal vivo: qualcuno ha appena gridato un nome e
 * restano pochi secondi per decidere un rilancio. Da qui i tre strati, in
 * ordine di quanto in fretta si devono leggere:
 *
 *   1. La testata, con il FVM composto piu' grande del nome. L'identita' e'
 *      l'unica cosa che l'utente gia' sa; il valore no.
 *   2. Le tessere numeriche: quattro numeri che si leggono senza mettere a
 *      fuoco.
 *   3. Le card, per chi ha il tempo di approfondire.
 *
 * Ogni card ha la forma che i suoi dati meritano, invece di quattro pile
 * identiche di righe: il confronto gol/xG e' un grafico perche' li' il disegno
 * dice qualcosa che i due numeri separati non dicono; lo storico infortuni e'
 * una sequenza perche' tre stop brevi e un crociato non sono la stessa cosa
 * anche a parita' di giorni totali.
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

  const { economics, performance, analytics, injuries } = sections;
  // Il filo cromatico della schermata: il colore del ruolo, che e' semantica di
  // dominio (US1-T2) e non una scelta grafica fatta qui.
  const accent = ROLE_COLORS[player.r];

  return (
    <>
      <Stack.Screen options={{ title: player.nome }} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {economics && (
          <PlayerHero
            player={player}
            fvm={economics.headline.fvm}
            quotazione={economics.headline.quotazione}
            variazione={economics.headline.variazione}
            trend={economics.headline.trend}
            categoryName={category?.name ?? null}
            categoryColor={category?.color ?? null}
            onPressCategory={() => setSheetOpen(true)}
          />
        )}

        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator color={accent} />
          </View>
        )}

        {/* Nessuna metrica: lo si dice una volta sola, e si dice il perche'. */}
        {!loading && stats === undefined && (
          <SectionCard title="Statistiche" accent={accent}>
            <MetricUnavailable message={describeMissingData(undefined)} />
          </SectionCard>
        )}

        {/* --- Strato 2: i quattro numeri che si leggono per primi --- */}
        {performance.available && (
          <View style={styles.tiles}>
            {performance.tiles.map((tile) => (
              <StatTile key={tile.label} {...tile} />
            ))}
          </View>
        )}

        {performance.available && (
          <SectionCard
            title={performance.title}
            accent={accent}
            trailing={<RatingBadge band={performance.ratingBand} />}
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
            accent={accent}
            trailing={<VerdictBadge verdict={analytics.goalVerdict} />}
            subtitle={
              analytics.per90Reliable
                ? undefined
                : 'Pochi minuti giocati: i valori per 90′ sono poco indicativi.'
            }
          >
            {/* L'elemento firma: realizzato contro atteso, stessa scala. */}
            <XgDuel {...analytics.goalDuel} verdict={analytics.goalVerdict} />
            <XgDuel {...analytics.assistDuel} verdict={analytics.assistVerdict} />

            <View style={styles.divider} />

            {analytics.lines.map((line) => (
              <StatBar key={line.label} {...line} />
            ))}
          </SectionCard>
        )}

        {injuries.available && (
          <SectionCard
            title={injuries.title}
            accent={accent}
            trailing={<RiskBadge band={injuries.band} />}
          >
            {injuries.lines.map((line) => (
              <StatBar key={line.label} {...line} />
            ))}

            {stats !== undefined && <InjuryTimeline spells={stats.injuries.history} />}
          </SectionCard>
        )}

        {economics && (
          <SectionCard title={economics.detailsTitle} accent={accent}>
            {economics.details.map((line) => (
              <StatBar key={line.label} {...line} />
            ))}
          </SectionCard>
        )}

        {/* Da dove vengono i numeri: chiude la scheda senza rubare attenzione. */}
        {stats !== undefined && (
          <Text style={styles.provenance}>
            Metriche aggiornate al{' '}
            {new Date(stats.updatedAt).toLocaleDateString('it-IT', {
              day: 'numeric',
              month: 'long',
            })}
            .
          </Text>
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
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  provenance: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
