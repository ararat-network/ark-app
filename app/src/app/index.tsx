// The scaffold's one screen: it calls the native module once and says whether
// native code answered. It is here to show that the app builds, links, and
// calls Swift, Kotlin, and C, and it goes when the first real screen arrives.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { judge, NativeCheck, PROBE, utf8 } from "../../modules/native-check";
import { type StringKey, strings } from "../strings";

function checkNative(): StringKey {
  if (!NativeCheck) return "scaffold.native.unavailable";
  try {
    return judge(NativeCheck.reverse(utf8(PROBE))) === "ok" ? "scaffold.native.ok" : "scaffold.native.mismatch";
  } catch {
    return "scaffold.native.mismatch";
  }
}

export default function Scaffold() {
  // Once, when the screen first renders: the call is synchronous and has nothing to wait for.
  const [result] = useState(checkNative);
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{strings["scaffold.title"]}</Text>
      <Text style={styles.label}>{strings["scaffold.native"]}</Text>
      <Text style={styles.value} testID="native-check-result">
        {strings[result]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#ffffff" },
  title: { fontSize: 32, fontWeight: "600", color: "#111111" },
  label: { fontSize: 14, color: "#555555" },
  value: { fontSize: 16, color: "#111111" },
});
