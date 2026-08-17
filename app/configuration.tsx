import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  addConfiguration,
  editConfiguration,
} from '@/core/middleware/hooks/configurationHook';
import type { ConfigurationDraft } from '@/domain/configuration';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import { ConfigurationForm } from '@/ui/components/ConfigurationForm';
import { colors, spacing } from '@/ui/theme/theme';

/**
 * Creazione e modifica di una configurazione d'asta.
 *
 * Una sola route per entrambi i casi: distingue il parametro `id`. Il form e' lo
 * stesso del wizard di primo avvio, cosi' le regole di validazione e i campi non
 * possono divergere fra "prima volta" e "modifica".
 */
export default function ConfigurationScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();

  const configId = id === undefined ? undefined : Number.parseInt(id, 10);
  const initial = useConfigurationsStore((s) =>
    configId === undefined || Number.isNaN(configId) ? undefined : s.byId[configId]
  );

  const [busy, setBusy] = useState(false);

  const handleSubmit = async (draft: ConfigurationDraft) => {
    setBusy(true);
    const result = initial
      ? await editConfiguration(initial.id, draft)
      : await addConfiguration(draft);
    setBusy(false);

    if (!result.ok) {
      Alert.alert('Impossibile salvare', result.reason);
      return;
    }
    router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{ title: initial ? 'Modifica configurazione' : 'Nuova configurazione' }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <ConfigurationForm
            initial={initial}
            submitLabel={initial ? 'Salva modifiche' : 'Crea configurazione'}
            onSubmit={handleSubmit}
            busy={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
