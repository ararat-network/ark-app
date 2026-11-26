// The scaffold's one screen: it asks the signer's keystore to check its core
// once and says what it found. It is here to show that the app builds, links,
// and calls the keystore's Swift, Kotlin, and C from a sibling package, and
// it goes when the first real screen arrives.
import { checkKeystore, KEYSTORE_MODULE, type KeystoreNative } from "@ararat-network/signer/keystore";
import { requireOptionalNativeModule } from "expo";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { keystoreStatus } from "../keystore-status";
import { strings } from "../strings";

export default function Scaffold() {
  // Once, when the screen first renders: the check is synchronous and has nothing to wait for.
  const [status] = useState(() => keystoreStatus(checkKeystore(requireOptionalNativeModule<KeystoreNative>(KEYSTORE_MODULE))));
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{strings["scaffold.title"]}</Text>
      <Text style={styles.label}>{strings["scaffold.keystore"]}</Text>
      <Text style={styles.value} testID="keystore-check-result">
        {strings[status]}
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
