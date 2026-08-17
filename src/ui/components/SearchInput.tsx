import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { clearSearch, setSearchQuery } from '@/core/middleware/hooks/filterHook';
import { useFiltersStore } from '@/state/useFiltersStore';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Barra di ricerca (US2-T2).
 *
 * Non riceve props: si sottoscrive da solo a `searchQuery` e passa gli input
 * dalla filterPipeline. Cosi' la schermata non deve fare da tramite, e ogni
 * tasto premuto non ri-renderizza il contenitore della lista.
 */
export function SearchInput() {
  const query = useFiltersStore((s) => s.searchQuery);

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔍</Text>

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setSearchQuery}
        placeholder="Cerca calciatore o squadra..."
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        // Su iOS il clear nativo duplicherebbe il nostro pulsante X.
        clearButtonMode="never"
        accessibilityLabel="Campo di ricerca calciatori"
      />

      {/* US2-T2: la X compare solo con del testo digitato. */}
      {query.length > 0 && (
        <TouchableOpacity
          onPress={clearSearch}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Cancella ricerca"
          accessibilityRole="button"
        >
          <Text style={styles.clear}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 44,
    gap: spacing.sm,
  },
  icon: {
    fontSize: 15,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
    padding: 0,
  },
  clear: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
});
