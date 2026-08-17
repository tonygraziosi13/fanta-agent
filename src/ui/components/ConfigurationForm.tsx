import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  MAX_CONFIGURATION_NAME_LENGTH,
  createDefaultDraft,
  rosaSize,
  validateConfigurationDraft,
  type Configuration,
  type ConfigurationDraft,
  type RoleSlots,
} from '@/domain/configuration';
import { CLASSIC_ROLES, ROLE_COLORS, ROLE_LABELS, type ClassicRole } from '@/domain/roles';
import { useConfigurationsStore } from '@/state/useConfigurationsStore';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Form dei parametri d'asta, condiviso fra il wizard di primo avvio e la
 * schermata di modifica. Un solo posto in cui vivono campi, default e messaggi:
 * le due situazioni differiscono solo per il testo del pulsante.
 *
 * Il totale della rosa non e' un campo: e' la somma degli slot, mostrata in sola
 * lettura. Cosi' il numero visto dall'utente e la composizione per reparto non
 * possono divergere.
 */

interface Props {
  /** Assente in creazione; presente in modifica. */
  initial?: Configuration;
  submitLabel: string;
  onSubmit: (draft: ConfigurationDraft) => Promise<void> | void;
  busy?: boolean;
}

function draftFrom(initial: Configuration | undefined): ConfigurationDraft {
  if (!initial) return createDefaultDraft();
  return {
    name: initial.name,
    participants: initial.participants,
    credits: initial.credits,
    slots: { ...initial.slots },
  };
}

/**
 * I campi numerici restano stringhe finche' l'utente digita: azzerare il campo
 * per riscriverlo produce "" , che come numero sarebbe 0 o NaN e farebbe
 * saltare il cursore. La conversione avviene una volta sola, in fondo.
 */
export function ConfigurationForm({ initial, submitLabel, onSubmit, busy }: Props) {
  const configurations = useConfigurationsStore((s) => s.configurations);

  const [name, setName] = useState(() => draftFrom(initial).name);
  const [participants, setParticipants] = useState(() =>
    String(draftFrom(initial).participants)
  );
  const [credits, setCredits] = useState(() => String(draftFrom(initial).credits));
  const [slots, setSlots] = useState<RoleSlots>(() => draftFrom(initial).slots);

  const draft = useMemo<ConfigurationDraft>(
    () => ({
      name,
      participants: Number.parseInt(participants, 10),
      credits: Number.parseInt(credits, 10),
      slots,
    }),
    [name, participants, credits, slots]
  );

  const verdict = validateConfigurationDraft(draft, configurations, initial?.id);
  const valid = verdict === true;
  const total = rosaSize(slots);

  const bump = (role: ClassicRole, delta: number) =>
    setSlots((prev) => ({ ...prev, [role]: Math.max(0, prev[role] + delta) }));

  return (
    <View style={styles.root}>
      <Text style={styles.sectionLabel}>Nome</Text>
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Es. Lega degli amici"
          placeholderTextColor={colors.textMuted}
          maxLength={MAX_CONFIGURATION_NAME_LENGTH}
          returnKeyType="done"
        />
      </View>

      <Text style={styles.sectionLabel}>Asta</Text>
      <View style={styles.card}>
        <Field
          label="Partecipanti"
          hint="Quante squadre giocano la lega"
          value={participants}
          onChangeText={setParticipants}
        />
        <Field
          label="Crediti"
          hint="Budget a disposizione per l'asta"
          value={credits}
          onChangeText={setCredits}
        />
      </View>

      <Text style={styles.sectionLabel}>Composizione rosa</Text>
      <View style={styles.card}>
        {CLASSIC_ROLES.map((role) => (
          <View key={role} style={styles.slotRow}>
            <View style={[styles.roleDot, { backgroundColor: ROLE_COLORS[role] }]} />
            <Text style={styles.slotLabel}>{ROLE_LABELS[role]}</Text>

            <View style={styles.stepper}>
              <StepperButton
                label="−"
                accessibilityLabel={`Togli uno slot: ${ROLE_LABELS[role]}`}
                disabled={slots[role] === 0}
                onPress={() => bump(role, -1)}
              />
              <Text style={styles.slotValue}>{slots[role]}</Text>
              <StepperButton
                label="+"
                accessibilityLabel={`Aggiungi uno slot: ${ROLE_LABELS[role]}`}
                onPress={() => bump(role, 1)}
              />
            </View>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Totale in rosa</Text>
          <Text style={styles.totalValue}>
            {total} {total === 1 ? 'calciatore' : 'calciatori'}
          </Text>
        </View>
      </View>

      {!valid && <Text style={styles.error}>{verdict}</Text>}

      <TouchableOpacity
        onPress={() => onSubmit(draft)}
        disabled={!valid || busy === true}
        accessibilityRole="button"
        style={[styles.primaryButton, (!valid || busy === true) && styles.disabled]}
      >
        <Text style={styles.primaryLabel}>{submitLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Field({
  label,
  hint,
  value,
  onChangeText,
}: {
  label: string;
  hint: string;
  value: string;
  onChangeText: (next: string) => void;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldText}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldHint}>{hint}</Text>
      </View>
      <TextInput
        style={[styles.input, styles.numberInput]}
        value={value}
        onChangeText={(next) => onChangeText(next.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        maxLength={4}
        accessibilityLabel={label}
        returnKeyType="done"
      />
    </View>
  );
}

function StepperButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.stepperButton, disabled === true && styles.disabled]}
    >
      <Text style={styles.stepperLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
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
  numberInput: {
    width: 84,
    textAlign: 'center',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  fieldText: {
    flex: 1,
    gap: 2,
  },
  fieldLabel: {
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
  },
  fieldHint: {
    color: colors.textMuted,
    fontSize: typography.caption.fontSize,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  roleDot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
  },
  slotLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.body.fontSize,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  stepperLabel: {
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
  },
  slotValue: {
    minWidth: 28,
    textAlign: 'center',
    color: colors.textPrimary,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  totalLabel: {
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
  },
  totalValue: {
    color: colors.accent,
    fontSize: typography.bodyBold.fontSize,
    fontWeight: '800',
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption.fontSize,
  },
  primaryButton: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  primaryLabel: {
    color: '#0B1220',
    fontSize: typography.body.fontSize,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.4,
  },
});
