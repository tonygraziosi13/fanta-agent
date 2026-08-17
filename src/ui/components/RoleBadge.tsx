import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ROLE_COLORS, ROLE_TEXT_COLORS, type ClassicRole } from '@/domain/roles';
import { radius } from '@/ui/theme/theme';

/**
 * Pastiglia colorata del ruolo Classic (US1-T2).
 * La mappatura cromatica e' un criterio di accettazione, non un dettaglio
 * estetico: vive in domain/roles.ts, questo componente la disegna soltanto.
 */

interface Props {
  role: ClassicRole;
  size?: number;
}

function RoleBadgeComponent({ role, size = 30 }: Props) {
  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: ROLE_COLORS[role],
        },
      ]}
      accessibilityLabel={`Ruolo ${role}`}
    >
      <Text style={[styles.label, { color: ROLE_TEXT_COLORS[role], fontSize: size * 0.47 }]}>
        {role}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '800',
  },
});

export const RoleBadge = memo(RoleBadgeComponent);
