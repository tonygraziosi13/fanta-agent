import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, radius, spacing, typography } from '@/ui/theme/theme';

/**
 * Bottom sheet (US3-T2).
 *
 * Implementato su Modal + Animated di React Native invece di @gorhom/bottom-sheet.
 * Motivo: quella libreria richiede react-native-reanimated (v4 su questa SDK) e
 * react-native-worklets, una catena di dipendenze native con vincoli di versione
 * stretti. Qui servono un'apparizione dal basso e un backdrop: 130 righe su
 * Animated con useNativeDriver girano sul thread UI esattamente come reanimated,
 * senza aggiungere tre pacchetti nativi al progetto.
 * Se in futuro servissero gesture di trascinamento e snap point multipli, questo
 * componente e' l'unico punto da sostituire.
 */

const ANIMATION_MS = 220;

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ visible, onClose, title, children }: Props) {
  const { height } = useWindowDimensions();

  // `mounted` disaccoppia la visibilita' logica da quella del Modal: senza,
  // chiudendo il sheet il Modal sparirebbe istantaneamente e l'animazione di
  // uscita non si vedrebbe mai.
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: ANIMATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: ANIMATION_MS * 0.8,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, progress]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [height * 0.5, 0],
  });

  return (
    <Modal
      visible
      transparent
      // Necessario perche' il tasto "indietro" di Android chiuda il sheet
      // invece di uscire dalla schermata sottostante.
      onRequestClose={handleClose}
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            accessibilityLabel="Chiudi menu"
          />
        </Animated.View>

        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.grabber} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    // Margine per la home indicator / barra di navigazione gestuale.
    paddingBottom: spacing.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.heading.fontSize,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
});
