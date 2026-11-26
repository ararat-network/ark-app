// The scaffold's one screen. It shows that the app builds, links, and calls
// the signer's keystore, Swift, Kotlin, and C, from a sibling package: it
// asks the keystore to check its core, shows the key the phone holds, and
// has a button for each thing the keystore does, which is how the keystore is
// tried by hand on a phone. It goes when the first real screen arrives.
//
// In a build made with EXPO_PUBLIC_ARK_DEVICE_CHECK=1 it also runs the
// keystore's device check when it opens, and writes each line of it to the
// log, where the check scripts read them. No other build holds that.
import { checkKeystore, type DeviceKey, deviceKeystore, KEYSTORE_MODULE, type KeystoreNative } from "@ararat-network/signer/keystore";
import { checkOnDevice, signsAndVerifies } from "@ararat-network/signer/keystore/device-check";
import { requireOptionalNativeModule } from "expo";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { keyStatus, keystoreErrorString, keystorePrompt, keystoreStatus } from "../keystore-status";
import { type StringKey, strings } from "../strings";

const DEVICE_CHECK = process.env.EXPO_PUBLIC_ARK_DEVICE_CHECK === "1";

export default function Scaffold() {
  const native = useMemo(() => requireOptionalNativeModule<KeystoreNative>(KEYSTORE_MODULE), []);
  const keystore = useMemo(() => (native ? deviceKeystore(native, { prompt: keystorePrompt }) : null), [native]);
  // Once, when the screen first renders: the check is synchronous and has nothing to wait for.
  const [status] = useState(() => keystoreStatus(checkKeystore(native)));
  const [key, setKey] = useState<DeviceKey | null>(null);
  const [result, setResult] = useState<StringKey>("scaffold.result.none");
  const [busy, setBusy] = useState(false);

  /** Runs one thing the keystore does, says how it ended, and reads the key again. */
  const run = useCallback(
    async (action: () => Promise<StringKey>) => {
      if (!keystore) return;
      setBusy(true);
      try {
        setResult(await action());
      } catch (thrown) {
        setResult(keystoreErrorString(thrown));
      }
      setKey(await keystore.key().catch(() => null));
      setBusy(false);
    },
    [keystore],
  );

  useEffect(() => {
    if (!keystore) return;
    if (DEVICE_CHECK) {
      // To the device's log, where the check scripts read the check's lines.
      void run(async () =>
        (await checkOnDevice(native, { prompt: keystorePrompt, log: (line) => console.log(line) }))
          ? "scaffold.result.check_passed"
          : "scaffold.result.check_failed",
      );
    } else {
      void keystore.key().then(setKey, () => setKey(null));
    }
  }, [keystore, native, run]);

  const create = () =>
    run(async () => {
      await keystore?.create();
      return "scaffold.result.created";
    });
  const sign = () =>
    run(async () => {
      const held = await keystore?.key();
      if (!keystore || !held) return "scaffold.result.no_key";
      return (await signsAndVerifies(keystore, held, "signed by hand from the scaffold")) ? "scaffold.result.signed" : "scaffold.result.bad_signature";
    });
  const remove = () =>
    run(async () => {
      await keystore?.remove();
      return "scaffold.result.removed";
    });

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{strings["scaffold.title"]}</Text>
      <Text style={styles.label}>{strings["scaffold.keystore"]}</Text>
      <Text style={styles.value} testID="keystore-check-result">
        {strings[status]}
      </Text>
      <Text style={styles.label}>{strings["scaffold.key"]}</Text>
      {key ? (
        <Text style={styles.address} testID="keystore-key-address" selectable>
          {key.address}
        </Text>
      ) : null}
      {keyStatus(key).map((line) => (
        <Text key={line} style={styles.value}>
          {strings[line]}
        </Text>
      ))}
      <View style={styles.actions}>
        {(
          [
            ["scaffold.action.create", create],
            ["scaffold.action.sign", sign],
            ["scaffold.action.remove", remove],
          ] as const
        ).map(([label, action]) => (
          <Pressable
            key={label}
            style={[styles.action, busy || !keystore ? styles.disabled : null]}
            disabled={busy || !keystore}
            onPress={action}
            testID={label}
          >
            <Text style={styles.actionText}>{strings[label]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>{strings["scaffold.result"]}</Text>
      <Text style={styles.value} testID="keystore-result">
        {strings[result]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24, backgroundColor: "#ffffff" },
  title: { fontSize: 32, fontWeight: "600", color: "#111111" },
  label: { fontSize: 14, color: "#555555", marginTop: 12 },
  value: { fontSize: 16, color: "#111111", textAlign: "center" },
  address: { fontSize: 13, color: "#111111", textAlign: "center" },
  actions: { gap: 8, marginTop: 16, alignSelf: "stretch" },
  action: { paddingVertical: 12, borderRadius: 8, backgroundColor: "#111111", alignItems: "center" },
  disabled: { opacity: 0.4 },
  actionText: { fontSize: 16, color: "#ffffff" },
});
