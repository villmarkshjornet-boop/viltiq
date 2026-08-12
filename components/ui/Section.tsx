import { StyleSheet, Text, View, type ViewProps } from "react-native";
import { color, spacing, typography } from "@/src/design/tokens";

type SectionProps = ViewProps & {
  title: string;
  right?: React.ReactNode;
};

/** Tittel + innhold-gruppering — brukt til å skape hierarki uten å legge alt i separate kort (§15). */
export default function Section({ title, right, children, style, ...rest }: SectionProps) {
  return (
    <View style={[styles.wrap, style]} {...rest}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  title: { ...typography.sectionTitle, color: color.textPrimary },
});
