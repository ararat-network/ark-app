// The scaffold's one screen. It shows that the app builds, links, and calls
// the signer's keystore, Swift, Kotlin, and C, from a sibling package: it
// asks the keystore to check its core, shows the key the phone holds, and
// has a button for each thing the keystore does, which is how the keystore is
// tried by hand on a phone. It goes when the first real screen arrives.
//
// The key's seed phrase is drawn by one of the keystore's native views and
// entered into another, each placed here like any other view: this file says
// which positions are drawn and which is being entered, and never has a word.
//
// In a build made with EXPO_PUBLIC_ARK_DEVICE_CHECK=1 it also runs the
// keystore's device check when it opens, and writes each line of it to the
// log, where the check scripts read them. No other build holds that.
import {
  checkKeystore,
  type DeviceKey,
  deviceKeystore,
  KEYSTORE_MODULE,
  KEYSTORE_SEED_PHRASE_FIELD_VIEW,
  KEYSTORE_SEED_PHRASE_SUGGESTION_VIEW,
  KEYSTORE_SEED_PHRASE_WORD_VIEW,
  type KeystoreNative,
  SEED_PHRASE_WORDS,
  type SeedPhraseFieldProps,
  type SeedPhraseSuggestionProps,
  type SeedPhraseTyping,
  type SeedPhraseWordProps,
} from "@ararat-network/signer/keystore";
import { checkOnDevice, signsAndVerifies } from "@ararat-network/signer/keystore/device-check";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewProps } from "react-native";
import {
  fill,
  keyStatus,
  keystoreErrorString,
  keystorePrompt,
  keystoreStatus,
  seedPhraseCheckString,
  seedPhraseHiddenString,
  seedPhraseTypingString,
} from "../keystore-status";
import { type StringKey, strings } from "../strings";

const DEVICE_CHECK = process.env.EXPO_PUBLIC_ARK_DEVICE_CHECK === "1";
/** How long the device check leaves the seed phrase open, for whoever is reading the screen. */
const SEED_PHRASE_SHOWN_FOR_CHECK_MS = 6000;
/** How many words are drawn at a time when they are drawn a few at a time, as a member writes them down. */
const WORDS_AT_A_TIME = 4;
/** How many of the list's words are offered under the field. */
const SUGGESTIONS = 4;
const INK = "#111111";

type WordProps = ViewProps & SeedPhraseWordProps;
type FieldProps = ViewProps & SeedPhraseFieldProps;
type SuggestionProps = ViewProps & SeedPhraseSuggestionProps;

export default function Scaffold() {
  const native = useMemo(() => requireOptionalNativeModule<KeystoreNative>(KEYSTORE_MODULE), []);
  const keystore = useMemo(() => (native ? deviceKeystore(native, { prompt: keystorePrompt }) : null), [native]);
  // The native pieces exist only where the native module does. Each draws one thing, and this screen lays them out.
  const pieces = useMemo(
    () =>
      native
        ? {
            Word: requireNativeView<WordProps>(KEYSTORE_MODULE, KEYSTORE_SEED_PHRASE_WORD_VIEW) as ComponentType<WordProps>,
            Field: requireNativeView<FieldProps>(KEYSTORE_MODULE, KEYSTORE_SEED_PHRASE_FIELD_VIEW) as ComponentType<FieldProps>,
            Suggestion: requireNativeView<SuggestionProps>(KEYSTORE_MODULE, KEYSTORE_SEED_PHRASE_SUGGESTION_VIEW) as ComponentType<SuggestionProps>,
          }
        : null,
    [native],
  );
  // Once, when the screen first renders: the check is synchronous and has nothing to wait for.
  const [status] = useState(() => keystoreStatus(checkKeystore(native)));
  const [key, setKey] = useState<DeviceKey | null>(null);
  const [result, setResult] = useState<string>(strings["scaffold.result.none"]);
  const [busy, setBusy] = useState(false);
  // The device check has the whole seed phrase drawn, where its script reads the first and the last word.
  const [few, setFew] = useState(!DEVICE_CHECK);
  const [first, setFirst] = useState(0);
  const [position, setPosition] = useState(0);
  const [entered, setEntered] = useState(0);
  const [typing, setTyping] = useState<SeedPhraseTyping>("empty");

  /** Runs one thing the keystore does, says how it ended, and reads the key again. */
  const run = useCallback(
    async (action: () => Promise<StringKey | string>) => {
      if (!keystore) return;
      setBusy(true);
      try {
        const ended = await action();
        setResult(ended in strings ? strings[ended as StringKey] : ended);
      } catch (thrown) {
        setResult(strings[keystoreErrorString(thrown)]);
      }
      setKey(await keystore.key().catch(() => null));
      setBusy(false);
    },
    [keystore],
  );

  // What the keystore says with nobody asking: positions, counts, and reasons, and never a word.
  useEffect(() => {
    if (!keystore) return;
    const stops = [
      keystore.onSeedPhraseHidden((reason) => setResult(strings[seedPhraseHiddenString(reason)])),
      keystore.onEntryChange((change) => setTyping(change.typing)),
      keystore.onEntryWord((word) => {
        setEntered(word.entered);
        setTyping("empty");
        // The entry has moved on by itself, as a member reading down the paper goes: the position here follows it.
        setPosition(word.next);
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [keystore]);

  useEffect(() => {
    if (!keystore) return;
    if (DEVICE_CHECK) {
      void run(async () => {
        const passed = await checkOnDevice(native, {
          prompt: keystorePrompt,
          // To the device's log, where the check scripts read the check's lines.
          log: (line) => console.log(line),
          whileSeedPhraseShown: () => new Promise((resolve) => setTimeout(resolve, SEED_PHRASE_SHOWN_FOR_CHECK_MS)),
        });
        return passed ? "scaffold.result.check_passed" : "scaffold.result.check_failed";
      });
    } else {
      void keystore.key().then(setKey, () => setKey(null));
    }
  }, [keystore, native, run]);

  const actions: [StringKey, () => Promise<StringKey | string>][] = [
    [
      "scaffold.action.create",
      async () => {
        await keystore?.create();
        return "scaffold.result.created";
      },
    ],
    [
      "scaffold.action.sign",
      async () => {
        const held = await keystore?.key();
        if (!keystore || !held) return "scaffold.result.no_key";
        return (await signsAndVerifies(keystore, held, "signed by hand from the scaffold")) ? "scaffold.result.signed" : "scaffold.result.bad_signature";
      },
    ],
    [
      "scaffold.action.remove",
      async () => {
        await keystore?.hideSeedPhrase();
        await keystore?.remove();
        return "scaffold.result.removed";
      },
    ],
    [
      "scaffold.action.show_seed_phrase",
      async () => {
        await keystore?.showSeedPhrase();
        return "scaffold.result.seed_phrase_shown";
      },
    ],
    [
      "scaffold.action.hide_seed_phrase",
      async () => {
        await keystore?.hideSeedPhrase();
        return "scaffold.result.seed_phrase_hidden";
      },
    ],
  ];

  const entryActions: [StringKey, () => Promise<StringKey | string>][] = [
    ["scaffold.action.entry_check", async () => (keystore ? seedPhraseCheckString(await keystore.checkSeedPhrase()) : "scaffold.result.no_key")],
    [
      "scaffold.action.entry_mistakes",
      async () => {
        if (!keystore) return "scaffold.result.no_key";
        const mistakes = await keystore.seedPhraseMistakes();
        if (mistakes.length === 0) return "scaffold.result.entry.no_mistakes";
        // Positions as a member counts them, from 1.
        return fill("scaffold.result.entry.mistakes", { positions: mistakes.map((at) => at + 1).join(", ") });
      },
    ],
    [
      "scaffold.action.entry_restore",
      async () => {
        await keystore?.restoreFromSeedPhrase();
        return "scaffold.result.entry.restored";
      },
    ],
    [
      "scaffold.action.entry_clear",
      async () => {
        await keystore?.clearEntry();
        setPosition(0);
        setEntered(0);
        setTyping("empty");
        return "scaffold.result.entry.cleared";
      },
    ],
  ];

  const button = (label: StringKey, onPress: () => void, disabled = false) => (
    <Pressable
      key={label}
      style={[styles.action, disabled || busy || !keystore ? styles.disabled : null]}
      disabled={disabled || busy || !keystore}
      onPress={onPress}
      testID={label}
    >
      <Text style={styles.actionText}>{strings[label]}</Text>
    </Pressable>
  );

  /** One numbered word: the number is this screen's, and the word is the native piece's. */
  const word = (at: number, large: boolean) =>
    pieces ? (
      <View key={at} style={large ? styles.largeWord : styles.smallWord}>
        <Text style={large ? styles.largeNumber : styles.smallNumber}>{at + 1}</Text>
        <pieces.Word position={at} style={styles.wordPiece} color={INK} fontSize={large ? 24 : 16} fontWeight="medium" />
      </View>
    ) : null;
  const shown = few ? WORDS_AT_A_TIME : SEED_PHRASE_WORDS;
  const columns = few ? 1 : 3;
  const rows = shown / columns;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
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
        {result}
      </Text>
      <View style={styles.actions}>{actions.map(([label, action]) => button(label, () => void run(action)))}</View>

      <Text style={styles.label}>{strings["scaffold.seed_phrase"]}</Text>
      <View style={styles.words}>
        {Array.from({ length: columns }, (_, column) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the columns are fixed places, read downward
          <View key={column} style={styles.column}>
            {Array.from({ length: rows }, (_, row) => word((few ? first : 0) + column * rows + row, few))}
          </View>
        ))}
      </View>
      <View style={styles.row}>
        {button("scaffold.action.seed_phrase_previous", () => setFirst(Math.max(0, first - WORDS_AT_A_TIME)), !few || first === 0)}
        {button(
          "scaffold.action.seed_phrase_next",
          () => setFirst(Math.min(SEED_PHRASE_WORDS - WORDS_AT_A_TIME, first + WORDS_AT_A_TIME)),
          !few || first + WORDS_AT_A_TIME >= SEED_PHRASE_WORDS,
        )}
      </View>
      <View style={styles.actions}>{button(few ? "scaffold.action.seed_phrase_all" : "scaffold.action.seed_phrase_few", () => setFew(!few))}</View>

      <Text style={styles.label}>{strings["scaffold.entry"]}</Text>
      <Text style={styles.value} testID="entry-position">
        {fill("scaffold.entry.position", { position: position + 1, total: SEED_PHRASE_WORDS })}
      </Text>
      {pieces ? (
        <>
          <View style={styles.field}>
            <pieces.Field style={styles.fieldPiece} color={INK} fontSize={24} fontWeight="medium" />
          </View>
          <View style={styles.suggestions}>
            {Array.from({ length: SUGGESTIONS }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the words offered are fixed places, first to last
              <pieces.Suggestion key={index} index={index} style={styles.suggestion} color={INK} fontSize={17} />
            ))}
          </View>
        </>
      ) : null}
      <Text style={styles.hint}>{strings[seedPhraseTypingString(typing)]}</Text>
      <Text style={styles.hint} testID="entry-entered">
        {fill("scaffold.entry.entered", { entered, total: SEED_PHRASE_WORDS })}
      </Text>
      <View style={styles.actions}>
        {button(
          "scaffold.action.entry_previous",
          () => {
            setPosition(position - 1);
            void keystore?.moveEntry(position - 1);
          },
          position === 0,
        )}
        {entryActions.map(([label, action]) => button(label, () => void run(action)))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#ffffff" },
  screen: { alignItems: "center", gap: 8, paddingHorizontal: 24, paddingTop: 72, paddingBottom: 48 },
  title: { fontSize: 32, fontWeight: "600", color: INK },
  label: { fontSize: 14, color: "#555555", marginTop: 12 },
  value: { fontSize: 16, color: INK, textAlign: "center" },
  hint: { fontSize: 14, color: "#555555", textAlign: "center" },
  address: { fontSize: 13, color: INK, textAlign: "center" },
  actions: { gap: 8, marginTop: 8, alignSelf: "stretch" },
  row: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  action: { flexGrow: 1, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8, backgroundColor: INK, alignItems: "center" },
  disabled: { opacity: 0.4 },
  actionText: { fontSize: 16, color: "#ffffff" },
  // The seed phrase, laid out here: columns read downward, each word a number of this screen's beside a native piece.
  words: { flexDirection: "row", gap: 12, alignSelf: "stretch" },
  column: { flex: 1 },
  smallWord: { flexDirection: "row", alignItems: "center", gap: 6, height: 32 },
  largeWord: { flexDirection: "row", alignItems: "center", gap: 12, height: 48 },
  smallNumber: { width: 22, textAlign: "right", fontSize: 13, color: "#555555" },
  largeNumber: { width: 28, textAlign: "right", fontSize: 16, color: "#555555" },
  wordPiece: { flex: 1, alignSelf: "stretch" },
  // The field, in a border of this screen's, and under it the words of the list that begin with what is typed.
  field: { alignSelf: "stretch", height: 52, borderWidth: 1, borderColor: "#cccccc", borderRadius: 8, paddingHorizontal: 12 },
  fieldPiece: { flex: 1 },
  suggestions: { flexDirection: "row", gap: 8, alignSelf: "stretch", height: 40 },
  suggestion: { flex: 1, backgroundColor: "#f2f2f7", borderRadius: 8 },
});
