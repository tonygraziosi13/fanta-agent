import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { assignPlayer, unassignPlayer } from '@/core/middleware/hooks/assignmentHook';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { usePlayersStore } from '@/state/usePlayersStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';
import { BottomSheet } from './BottomSheet';

/**
 * Menu contestuale di assegnazione (US3-T2, US6-T1).
 *
 * Le categorie sono lette dallo store, non hardcoded: l'utente puo' crearne e
 * rinominarle, e il menu si adegua senza modifiche.
 *
 * Nessuna conferma dopo il tocco (US3): la selezione assegna e chiude.
 * L'azione distruttiva "Rimuovi" e' l'eccezione — separata graficamente e in
 * fondo, per non finirci sopra per errore.
 */

interface Props {
  /** Id del giocatore da assegnare; null = sheet chiuso. */
  playerId: number | null;
  onClose: () => void;
}

export function CategorySheet({ playerId, onClose }: Props) {
  const categories = useCategoriesStore((s) => s.categories);
  const player = usePlayersStore((s) => (playerId === null ? undefined : s.byId[playerId]));
  const currentCategoryId = useWatchlistStore((s) =>
    playerId === null ? undefined : s.assignments[playerId]
  );

  const handleAssign = (categoryId: number) => {
    if (playerId === null) return;
    // Ritoccare la categoria gia' attiva vale come "togli da qui": evita il
    // vicolo cieco in cui l'unico modo di deselezionare e' cercare il tasto rosso.
    if (categoryId === currentCategoryId) {
      unassignPlayer(playerId);
    } else {
      assignPlayer(playerId, categoryId);
    }
    // Chiusura immediata: reduce e' gia' avvenuto in modo sincrono, la lista
    // sottostante e' gia' aggiornata. La scrittura su DB prosegue in background.
    onClose();
  };

  const handleRemove = () => {
    if (playerId === null) return;
    unassignPlayer(playerId);
    onClose();
  };

  return (
    <BottomSheet
      visible={playerId !== null}
      onClose={onClose}
      title={player ? player.nome : 'Assegna categoria'}
    >
      {player ? (
        <Text style={styles.subtitle}>
          {player.squadra} · {player.r} · Qt. {player.qt_a} · FVM {player.fvm}
        </Text>
      ) : null}

      <View style={styles.list}>
        {categories.map((category) => {
          const isCurrent = category.id === currentCategoryId;
          return (
            <TouchableOpacity
              key={category.id}
              onPress={() => handleAssign(category.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected: isCurrent }}
              style={[
                styles.option,
                isCurrent && { borderColor: category.color, backgroundColor: colors.surface },
              ]}
            >
              <View style={[styles.dot, { backgroundColor: category.color }]} />
              <Text style={styles.optionLabel}>{category.name}</Text>
              {isCurrent && <Text style={styles.currentMark}>✓</Text>}
            </TouchableOpacity>
          );
        })}
      </View>

      {currentCategoryId !== undefined && (
        <TouchableOpacity
          onPress={handleRemove}
          activeOpacity={0.7}
          accessibilityRole="button"
          style={styles.destructive}
        >
          <Text style={styles.destructiveLabel}>Rimuovi dalla Lista</Text>
        </TouchableOpacity>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
  },
  optionLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
  currentMark: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  destructive: {
    marginTop: spacing.lg,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  destructiveLabel: {
    color: colors.danger,
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
});
