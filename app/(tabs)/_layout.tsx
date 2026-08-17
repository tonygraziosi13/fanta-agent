import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { useWatchlistStore } from '@/state/useWatchlistStore';
import { colors } from '@/ui/theme/theme';

/**
 * Bottom Tab Bar (US5-T1), estesa con la Home delle configurazioni d'asta.
 *
 * L'ordine non e' casuale: la Home viene prima perche' i parametri dell'asta
 * sono il contesto di tutto il resto, ma Listone e Watchlist restano a un solo
 * tap — non sono state sepolte in un sottomenu.
 *
 * Il badge sul tab Watchlist si sottoscrive al solo conteggio: assegnare un
 * giocatore aggiorna il numero senza ri-renderizzare le schermate.
 */
export default function TabsLayout() {
  const total = useWatchlistStore((s) => Object.keys(s.assignments).length);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '800' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏠</Text>,
        }}
      />
      <Tabs.Screen
        name="listone"
        options={{
          title: 'Listone',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📋</Text>,
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: 'Watchlist',
          tabBarBadge: total > 0 ? total : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: '#0B1220' },
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>⭐</Text>,
        }}
      />
    </Tabs>
  );
}
