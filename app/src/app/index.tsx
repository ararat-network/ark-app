// The scaffold's one screen. It shows that the app builds, links, and calls
// the signer's keystore, Swift, Kotlin, and C, from a sibling package: it
// asks the keystore to check its core, shows the key the phone holds, and
// has a button for each thing the keystore does, which is how the keystore is
// tried by hand on a phone. It goes when the first real screen arrives.
//
// The key's 24 words are drawn by the keystore's native view, placed here
// like any other view: this file asks it to show them and never has them.
//
// In a build made with EXPO_PUBLIC_ARK_DEVICE_CHECK=1 it also runs the
// keystore's device check when it opens, and writes each line of it to the
// log, where the check scripts read them. No other build holds that.
import {
  checkKeystore,
  type DeviceKey,
  deviceKeystore,
  KEYSTORE_MODULE,
  KEYSTORE_SEED_PHRASE_VIEW,
  type KeystoreNative,
  type KeystoreSeedPhraseView,
  type SeedPhraseHidden,
} from "@ararat-network/signer/keystore";
import { checkOnDevice, signsAndVerifies } from "@ararat-network/signer/keystore/device-check";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import { type ComponentType, type Ref, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View, type ViewProps } from "react-native";
import { keyStatus, keystoreErrorString, keystorePrompt, keystoreStatus, seedPhraseHiddenString } from "../keystore-status";
import { type StringKey, strings } from "../strings";

const DEVICE_CHECK = process.env.EXPO_PUBLIC_ARK_DEVICE_CHECK === "1";
/** How long the device check leaves the words drawn, for whoever is reading the screen. */
const SEED_PHRASE_SHOWN_FOR_CHECK_MS = 6000;
/** How far under the top of the screen the device check puts the seed phrase's label, clear of the system's bar. */
const ROOM_ABOVE_SEED_PHRASE = 48;

interface SeedPhraseViewProps extends ViewProps {
  ref?: Ref<KeystoreSeedPhraseView>;
  /** As "#RRGGBB"; the system's own text colours where none is given. */
  wordColor?: string;
  numberColor?: string;
  onHide?(event: { nativeEvent: { reason: SeedPhraseHidden } }): void;
}

export default function Scaffold() {
  const native = useMemo(() => requireOptionalNativeModule<KeystoreNative>(KEYSTORE_MODULE), []);
  const keystore = useMemo(() => (native ? deviceKeystore(native, { prompt: keystorePrompt }) : null), [native]);
  // The native view exists only where the native module does.
  const SeedPhraseView = useMemo<ComponentType<SeedPhraseViewProps> | null>(
    () => (native ? requireNativeView<SeedPhraseViewProps>(KEYSTORE_MODULE, KEYSTORE_SEED_PHRASE_VIEW) : null),
    [native],
  );
  const words = useRef<KeystoreSeedPhraseView>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  /** How far down the screen's content the seed phrase's label is, which is where the device check scrolls to. */
  const seedPhraseTop = useRef(0);
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
      void run(async () => {
        const passed = await checkOnDevice(native, {
          prompt: keystorePrompt,
          // To the device's log, where the check scripts read the check's lines.
          log: (line) => console.log(line),
          seedPhraseView: () => words.current,
          // Scrolled to first: the check's script reads the words off the screen, and a small screen has them below
          // its edge, where nothing that reads the screen finds them.
          whileSeedPhraseShown: () => {
            scroll.current?.scrollTo({ y: Math.max(0, seedPhraseTop.current - ROOM_ABOVE_SEED_PHRASE), animated: false });
            return new Promise((resolve) => setTimeout(resolve, SEED_PHRASE_SHOWN_FOR_CHECK_MS));
          },
        });
        return passed ? "scaffold.result.check_passed" : "scaffold.result.check_failed";
      });
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
      await words.current?.hide();
      await keystore?.remove();
      return "scaffold.result.removed";
    });
  const showSeedPhrase = () =>
    run(async () => {
      if (!keystore || !words.current) return "scaffold.result.no_key";
      await keystore.showSeedPhrase(words.current);
      return "scaffold.result.seed_phrase_shown";
    });
  const hideSeedPhrase = () =>
    run(async () => {
      await words.current?.hide();
      return "scaffold.result.seed_phrase_hidden";
    });

  return (
    <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.screen}>
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
      <Text style={styles.label}>{strings["scaffold.result"]}</Text>
      <Text style={styles.value} testID="keystore-result">
        {strings[result]}
      </Text>
      <View style={styles.actions}>
        {(
          [
            ["scaffold.action.create", create],
            ["scaffold.action.sign", sign],
            ["scaffold.action.remove", remove],
            ["scaffold.action.show_seed_phrase", showSeedPhrase],
            ["scaffold.action.hide_seed_phrase", hideSeedPhrase],
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
      <Text
        style={styles.label}
        onLayout={(event) => {
          seedPhraseTop.current = event.nativeEvent.layout.y;
        }}
      >
        {strings["scaffold.seed_phrase"]}
      </Text>
      {SeedPhraseView ? (
        <SeedPhraseView
          ref={words}
          style={styles.words}
          wordColor="#111111"
          numberColor="#555555"
          onHide={(event) => setResult(seedPhraseHiddenString(event.nativeEvent.reason))}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#ffffff" },
  screen: { alignItems: "center", gap: 8, paddingHorizontal: 24, paddingTop: 72, paddingBottom: 48 },
  title: { fontSize: 32, fontWeight: "600", color: "#111111" },
  label: { fontSize: 14, color: "#555555", marginTop: 12 },
  value: { fontSize: 16, color: "#111111", textAlign: "center" },
  address: { fontSize: 13, color: "#111111", textAlign: "center" },
  actions: { gap: 8, marginTop: 16, alignSelf: "stretch" },
  action: { paddingVertical: 12, borderRadius: 8, backgroundColor: "#111111", alignItems: "center" },
  disabled: { opacity: 0.4 },
  actionText: { fontSize: 16, color: "#ffffff" },
  // Eight rows of words, each given room to be read.
  words: { alignSelf: "stretch", height: 264 },
});
