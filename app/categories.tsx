import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { countPlayersInCategory } from '@/core/repositories/categoriesRepository';
import {
  addCategory,
  moveCategory,
  recolorCategory,
  removeCategory,
  renameCategory,
} from '@/core/middleware/hooks/categoryHook';
import { CATEGORY_PALETTE, MAX_CATEGORY_NAME_LENGTH } from '@/domain/category';
import { useCategoriesStore } from '@/state/useCategoriesStore';
import { useWatchlistStore } from '@/state/useWatchlistStore';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Gestione delle categorie personalizzate.
 *
 * Schermata fuori dallo scope delle User Stories: nasce dalla scelta di rendere
 * le categorie editabili invece che hardcoded.
 */
export default function CategoriesScreen() {
  const categories = useCategoriesStore((s) => s.categories);
  const assignments = useWatchlistStore((s) => s.assignments);

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>(CATEGORY_PALETTE[0] ?? '#22C55E');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');

  const countFor = (categoryId: number) =>
    Object.values(assignments).filter((id) => id === categoryId).length;

  const handleCreate = async () => {
    const result = await addCategory(newName, newColor);
    if (!result.ok) {
      Alert.alert('Impossibile creare', result.reason);
      return;
    }
    setNewName('');
  };

  const handleRename = async (id: number) => {
    const result = await renameCategory(id, draftName);
    if (!result.ok) {
      Alert.alert('Impossibile rinominare', result.reason);
      return;
    }
    setEditingId(null);
  };

  /**
   * Conferma esplicita: l'eliminazione porta via anche le assegnazioni
   * (ON DELETE CASCADE). Il conteggio viene riletto dal DB e non dedotto dalla
   * mappa in memoria — e' il numero reale di record che verranno cancellati, e
   * comprende le configurazioni diverse da quella attiva, che l'utente non ha
   * sotto gli occhi: le categorie sono condivise fra tutte le leghe.
   */
  const handleDelete = async (id: number, name: string) => {
    const affected = await countPlayersInCategory(id);
    const message =
      affected === 0
        ? `Eliminare la categoria "${name}"?`
        : `Eliminando "${name}" perderai anche l'assegnazione di ${affected} ` +
          `${affected === 1 ? 'giocatore' : 'giocatori'}, in tutte le configurazioni. ` +
          'I calciatori restano nel listone.';

    Alert.alert('Eliminare categoria', message, [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina',
        style: 'destructive',
        onPress: async () => {
          const result = await removeCategory(id);
          if (!result.ok) Alert.alert('Impossibile eliminare', result.reason);
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>Nuova categoria</Text>

      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={newName}
          onChangeText={setNewName}
          placeholder="Nome categoria"
          placeholderTextColor={colors.textMuted}
          maxLength={MAX_CATEGORY_NAME_LENGTH}
          returnKeyType="done"
          onSubmitEditing={handleCreate}
        />

        <View style={styles.palette}>
          {CATEGORY_PALETTE.map((color) => (
            <TouchableOpacity
              key={color}
              onPress={() => setNewColor(color)}
              accessibilityRole="button"
              accessibilityLabel={`Colore ${color}`}
              accessibilityState={{ selected: newColor === color }}
              style={[
                styles.swatch,
                { backgroundColor: color },
                newColor === color && styles.swatchSelected,
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          onPress={handleCreate}
          disabled={newName.trim() === ''}
          style={[styles.primaryButton, newName.trim() === '' && styles.disabled]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryLabel}>Aggiungi categoria</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Categorie ({categories.length})</Text>

      {categories.map((category, index) => {
        const isEditing = editingId === category.id;
        const count = countFor(category.id);

        return (
          <View key={category.id} style={styles.card}>
            <View style={styles.rowHead}>
              <View style={[styles.dot, { backgroundColor: category.color }]} />

              {isEditing ? (
                <TextInput
                  style={[styles.input, styles.inlineInput]}
                  value={draftName}
                  onChangeText={setDraftName}
                  maxLength={MAX_CATEGORY_NAME_LENGTH}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => handleRename(category.id)}
                />
              ) : (
                <Text style={styles.categoryName}>{category.name}</Text>
              )}

              <Text style={styles.count}>
                {count} {count === 1 ? 'giocatore' : 'giocatori'}
              </Text>
            </View>

            {isEditing && (
              <View style={styles.palette}>
                {CATEGORY_PALETTE.map((color) => (
                  <TouchableOpacity
                    key={color}
                    onPress={() => recolorCategory(category.id, color)}
                    accessibilityRole="button"
                    accessibilityLabel={`Colore ${color}`}
                    style={[
                      styles.swatch,
                      { backgroundColor: color },
                      category.color === color && styles.swatchSelected,
                    ]}
                  />
                ))}
              </View>
            )}

            <View style={styles.actions}>
              {isEditing ? (
                <>
                  <ActionButton label="Salva" onPress={() => handleRename(category.id)} />
                  <ActionButton label="Annulla" onPress={() => setEditingId(null)} />
                </>
              ) : (
                <>
                  <ActionButton
                    label="Rinomina"
                    onPress={() => {
                      setEditingId(category.id);
                      setDraftName(category.name);
                    }}
                  />
                  <ActionButton
                    label="↑"
                    disabled={index === 0}
                    onPress={() => moveCategory(category.id, -1)}
                  />
                  <ActionButton
                    label="↓"
                    disabled={index === categories.length - 1}
                    onPress={() => moveCategory(category.id, 1)}
                  />
                  <ActionButton
                    label="Elimina"
                    destructive
                    // Ultima categoria non eliminabile: senza categorie il
                    // bottom sheet di assegnazione resterebbe vuoto e la
                    // watchlist diverrebbe inutilizzabile.
                    disabled={categories.length <= 1}
                    onPress={() => handleDelete(category.id, category.name)}
                  />
                </>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function ActionButton({
  label,
  onPress,
  destructive,
  disabled,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[
        styles.actionButton,
        destructive && { borderColor: colors.danger },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionLabel, destructive && { color: colors.danger }]}>
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
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
  },
  categoryName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
  },
  count: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  inlineInput: {
    flex: 1,
  },
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colors.textPrimary,
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
  disabled: {
    opacity: 0.4,
  },
});
