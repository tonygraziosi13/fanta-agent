import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Player } from '@/domain/player';
import { ROLE_FILTER_ALL } from '@/domain/roles';
import { selectFilteredPlayers } from '@/state/selectors';
import { useFiltersStore } from '@/state/useFiltersStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { CategorySheet } from '@/ui/components/CategorySheet';
import { EmptyState } from '@/ui/components/EmptyState';
import { PlayerRow } from '@/ui/components/PlayerRow';
import { RoleFilterRow } from '@/ui/components/RoleFilterRow';
import { SearchInput } from '@/ui/components/SearchInput';
import { colors, spacing, typography } from '@/ui/theme/theme';

/**
 * Schermata Listone (US1-T3/T4, US2, punto di ingresso di US3).
 *
 * FlashList e non FlatList: US1-T3 chiede esplicitamente il riciclo delle viste.
 * FlatList smonta e rimonta i componenti fuori schermo, FlashList ne riusa le
 * istanze — con 497 righe la differenza si vede allo scroll rapido.
 */
export default function ListoneScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const players = usePlayersStore((s) => s.players);
  const status = usePlayersStore((s) => s.status);
  const load = usePlayersStore((s) => s.load);

  const searchQuery = useFiltersStore((s) => s.searchQuery);
  const activeRoleFilter = useFiltersStore((s) => s.activeRoleFilter);

  const [sheetPlayerId, setSheetPlayerId] = useState<number | null>(null);

  /**
   * US1-T4: innesco al montaggio.
   * Il boot hook ha gia' idratato lo store, quindi in condizioni normali questo
   * e' un no-op. Resta come rete di sicurezza per il fast refresh in sviluppo e
   * per un eventuale reset dello store: la guardia di rientro in load() evita
   * la doppia lettura.
   */
  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);

  /**
   * Stato derivato (US2-T1). useMemo e' obbligatorio, non cosmetico: senza,
   * ogni tasto premuto rifiltrerebbe 497 elementi E produrrebbe un array con
   * identita' nuova, invalidando la finestra di FlashList a ogni carattere.
   */
  const filtered = useMemo(
    () => selectFilteredPlayers(players, searchQuery, activeRoleFilter),
    [players, searchQuery, activeRoleFilter]
  );

  // Riferimento stabile: cambiarlo a ogni render vanificherebbe il memo di PlayerRow.
  const handlePressAssign = useCallback((playerId: number) => {
    setSheetPlayerId(playerId);
  }, []);

  // US21-1: il corpo della riga apre il dettaglio, il "+" continua ad assegnare.
  const handlePressDetail = useCallback(
    (playerId: number) => router.push(`/player/${playerId}`),
    [router]
  );

  const closeSheet = useCallback(() => setSheetPlayerId(null), []);

  const renderItem = useCallback(
    ({ item }: { item: Player }) => (
      <PlayerRow player={item} onPressAssign={handlePressAssign} onPress={handlePressDetail} />
    ),
    [handlePressAssign, handlePressDetail]
  );

  const isFiltering = searchQuery.trim() !== '' || activeRoleFilter !== ROLE_FILTER_ALL;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SearchInput />
        <RoleFilterRow />
        <Text style={styles.counter}>
          {filtered.length} {filtered.length === 1 ? 'calciatore' : 'calciatori'}
          {isFiltering ? ` su ${players.length}` : ''}
        </Text>
      </View>

      <FlashList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        // Nessuna stima di altezza: da FlashList v2 il dimensionamento e' automatico e
        // `estimatedItemSize` non esiste piu'. L'altezza fissa della riga resta comunque
        // definita in PlayerRow (PLAYER_ROW_HEIGHT), che e' cio' che rende il riciclo
        // efficiente.
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <EmptyState
            title="Nessun calciatore trovato"
            message={
              isFiltering
                ? 'Prova a modificare la ricerca o a rimuovere i filtri di ruolo.'
                : 'Il listone risulta vuoto.'
            }
          />
        }
      />

      <CategorySheet playerId={sheetPlayerId} onClose={closeSheet} />
    </View>
  );
}

const keyExtractor = (player: Player) => String(player.id);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  counter: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
  },
});
