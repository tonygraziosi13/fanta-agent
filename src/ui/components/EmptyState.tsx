import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/ui/theme/theme';

interface Props {
  icon?: string;
  title: string;
  message?: string;
}

export function EmptyState({ icon = '🔎', title, message }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  icon: {
    fontSize: 34,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
    textAlign: 'center',
  },
});
