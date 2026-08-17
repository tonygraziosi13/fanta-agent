import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { toggleRoleFilter } from '@/core/middleware/hooks/filterHook';
import { CLASSIC_ROLES, ROLE_COLORS, ROLE_FILTER_ALL, type RoleFilter } from '@/domain/roles';
import { useFiltersStore } from '@/state/useFiltersStore';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Pulsantiera dei ruoli (US2-T3).
 * Chip toggle: ripremere il ruolo attivo torna a "Tutti".
 */

const OPTIONS: Array<{ value: RoleFilter; label: string }> = [
  { value: ROLE_FILTER_ALL, label: 'Tutti' },
  ...CLASSIC_ROLES.map((r) => ({ value: r as RoleFilter, label: r })),
];

export function RoleFilterRow() {
  const active = useFiltersStore((s) => s.activeRoleFilter);

  return (
    <View style={styles.row}>
      {OPTIONS.map(({ value, label }) => {
        const isActive = active === value;
        const tint = value === ROLE_FILTER_ALL ? colors.accent : ROLE_COLORS[value];

        return (
          <TouchableOpacity
            key={value}
            onPress={() => toggleRoleFilter(value)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`Filtro ruolo ${label}`}
            style={[
              styles.chip,
              {
                backgroundColor: isActive ? tint : colors.surface,
                borderColor: isActive ? tint : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                // Stato inattivo reso da colore + opacita' (US2-T3).
                isActive ? styles.labelActive : styles.labelInactive,
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
  },
  labelActive: {
    color: '#0B1220',
  },
  labelInactive: {
    color: colors.textSecondary,
    opacity: 0.75,
  },
});
