import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { SlideInDown } from "react-native-reanimated";
import { color, elevation, motion, overlay, radius, spacing, zIndex } from "@/src/design/tokens";

type ModalSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Maks høyde i prosent av skjermen. Default 90 (samme som alle 6 modalene hadde fra før, hver for seg). */
  maxHeightPercent?: number;
};

/**
 * Redesign-oppdraget §31: ÉN felles bottom-sheet-kropp i stedet for at hver
 * skjerm oppfinner sin egen (funnet: 3 ulike overlay-opasiteter, radius fra
 * 14 til 32, ett sted uten håndtak, ett sted med "fade"+sentrert dialog i
 * stedet for slide+bunnankret). Erstatter <Modal>-innholdet i app/jakt.tsx
 * (×2), app/logg.tsx, app/kamera/[id].tsx (×2) og app/onboarding.tsx — selve
 * RN <Modal>-komponenten beholdes som ytre wrapper (uendret, den gir ekte
 * OS-nivå lagdeling og native tilbake-knapp-håndtering på Android), kun
 * "chrome" rundt innholdet (overlay, kortkontainer, håndtak, hjørneradius,
 * innslag-animasjon) er standardisert her.
 *
 * IKKE brukt for ekte bekreftelses-/feildialoger — de går via
 * src/lib/confirmAlert.ts sin visAlert() (window.confirm/alert på web,
 * native Alert.alert), som bevisst omgår <Modal> helt pga. en tidligere
 * funnet RN-Web-bug. Denne komponenten er kun for skjermer/lister/skjema,
 * som er det alle 6 eksisterende <Modal>-bruk faktisk er.
 *
 * Bakgrunn (overlay) og ark (sheet) er bevisst SØSKEN, ikke ark nøstet inni
 * bakgrunnens Pressable — unngår behovet for stopPropagation/responder-
 * hacks for å la trykk inni arket unngå å lukke modalen.
 */
export default function ModalSheet({ visible, onClose, children, maxHeightPercent = 90 }: ModalSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          entering={SlideInDown.duration(motion.base)}
          style={[
            styles.sheet,
            elevation.floating,
            { maxHeight: `${maxHeightPercent}%`, paddingBottom: insets.bottom + spacing.lg },
          ]}
        >
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: overlay.scrim,
    justifyContent: "flex-end",
    zIndex: zIndex.modal,
  },
  sheet: {
    backgroundColor: color.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    overflow: "hidden",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },
});
