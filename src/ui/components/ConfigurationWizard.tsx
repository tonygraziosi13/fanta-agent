import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addConfiguration } from '@/core/middleware/hooks/configurationHook';
import type { ConfigurationDraft } from '@/domain/configuration';
import { ConfigurationForm } from './ConfigurationForm';
import { colors, spacing, typography } from '@/ui/theme/theme';

/**
 * Setup di primo avvio.
 *
 * Non e' una schermata del router: viene montata *al posto* dello Stack finche'
 * non esiste alcuna configurazione, nello stesso spirito dell'interruzione
 * precoce del boot gate (US7-T4). Senza parametri d'asta il resto dell'app non
 * avrebbe dove salvare le scelte, e un wizard scavalcabile lascerebbe l'utente
 * in uno stato che il listone dovrebbe poi rifiutare.
 *
 * Alla creazione della prima configurazione lo store cambia, il gate si chiude
 * e la navigazione appare: nessuna route da chiudere a mano.
 */
export function ConfigurationWizard() {
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (draft: ConfigurationDraft) => {
    setBusy(true);
    const result = await addConfiguration(draft);
    setBusy(false);
    if (!result.ok) Alert.alert('Impossibile salvare', result.reason);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>Fanta Agent</Text>
          <Text style={styles.intro}>
            Prima di iniziare, imposta i parametri della tua asta. Potrai modificarli
            quando vuoi e creare altre configurazioni per le altre leghe.
          </Text>

          <ConfigurationForm
            submitLabel="Inizia"
            onSubmit={handleSubmit}
            busy={busy}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  brand: {
    color: colors.textPrimary,
    fontSize: typography.title.fontSize,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  intro: {
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
    lineHeight: 21,
  },
});
