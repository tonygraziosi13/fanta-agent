import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { runBootSequence, type BootPhase } from '@/core/middleware/hooks/bootHook';
import { useHasConfigurations } from '@/state/useConfigurationsStore';
import { ConfigurationWizard } from '@/ui/components/ConfigurationWizard';
import { SyncBanner } from '@/ui/components/SyncBanner';
import { colors, spacing, typography } from '@/ui/theme/theme';

/**
 * Root layout: il nodo sequenziale fisso del boot (US7-T4).
 *
 * E' il punto piu' a monte dell'app, immediatamente prima che l'interfaccia
 * diventi navigabile. Finche' il listone non e' scritto su disco, lo Stack non
 * viene nemmeno montato: e' l'interruzione precoce della navigazione richiesta
 * dalla US, non un overlay sopra una UI gia' viva.
 *
 * Subito dopo c'e' un secondo cancello, della stessa natura: senza alcuna
 * configurazione d'asta non c'e' nulla su cui lavorare, quindi al posto dello
 * Stack si monta il wizard di setup.
 */

// Va invocata a livello di modulo, prima di qualsiasi render.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Fallisce se lo splash e' gia' stato nascosto (fast refresh): innocuo.
});

const PHASE_LABEL: Record<BootPhase, string> = {
  idle: 'Avvio...',
  migrating: 'Preparazione database...',
  importing: 'Importazione listone Serie A...',
  hydrating: 'Caricamento in memoria...',
  ready: 'Pronto',
  error: 'Errore',
};

export default function RootLayout() {
  const [phase, setPhase] = useState<BootPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const hasConfigurations = useHasConfigurations();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await runBootSequence({
        onPhase: (p) => {
          if (!cancelled) setPhase(p);
        },
      });

      if (cancelled) return;
      if (result.phase === 'error') {
        setError(result.error ?? 'Errore sconosciuto durante l\'avvio.');
      }
      // Lo splash nativo cede il posto alla nostra schermata di stato solo ora:
      // cosi' l'utente non vede mai un frame vuoto fra i due.
      await SplashScreen.hideAsync().catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <SafeAreaProvider>
        <View style={styles.center}>
          <StatusBar style="light" />
          <Text style={styles.errorTitle}>Avvio non riuscito</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Text style={styles.errorHint}>
            Verifica che assets/data/listone.csv sia presente. Puoi rigenerarlo con
            {'\n'}
            <Text style={styles.mono}>npm run listone</Text>
          </Text>
        </View>
      </SafeAreaProvider>
    );
  }

  // Early exit: nessuna navigazione finche' i dati non ci sono (US7-T4).
  if (phase !== 'ready') {
    return (
      <SafeAreaProvider>
        <View style={styles.center}>
          <StatusBar style="light" />
          <Text style={styles.brand}>Fanta Agent</Text>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.phase}>{PHASE_LABEL[phase]}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  // Secondo cancello: nessuna configurazione, nessuna navigazione. Appena il
  // wizard ne crea una lo store cambia, questo ramo si spegne e lo Stack appare.
  if (!hasConfigurations) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ConfigurationWizard />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="categories"
          options={{ presentation: 'modal', title: 'Gestisci categorie' }}
        />
        <Stack.Screen name="configuration" options={{ presentation: 'modal' }} />
        {/* US21-T1: dettaglio calciatore. Spinta sopra le tab, non e' una destinazione. */}
        <Stack.Screen name="player/[id]" options={{ title: 'Calciatore' }} />
      </Stack>

      {/*
        Fuori dallo Stack di proposito: l'esito del sync in background riguarda
        l'app, non la schermata corrente, e deve restare visibile mentre
        l'utente naviga (US20-2).
      */}
      <SyncBanner />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  brand: {
    color: colors.textPrimary,
    fontSize: typography.title.fontSize,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  phase: {
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: typography.title.fontSize,
    fontWeight: '800',
  },
  errorBody: {
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
    textAlign: 'center',
  },
  errorHint: {
    color: colors.textSecondary,
    fontSize: typography.caption.fontSize,
    textAlign: 'center',
    lineHeight: 18,
  },
  mono: {
    fontFamily: 'monospace',
    color: colors.accent,
  },
});
