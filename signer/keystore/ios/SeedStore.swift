import CryptoKit
import Foundation
import LocalAuthentication
import Security

// The seed at rest on iOS, and the one place it is opened.
//
// The seed is encrypted to a P-256 key the Secure Enclave makes and never
// gives up, with the Enclave's own hybrid scheme, in one layer. The
// ciphertext is a Keychain item beside the public key and the protection the
// key was made with, which are no secret. Decrypting needs the Enclave's key,
// and that key asks the member to authenticate for every use.
//
// The seed is in this process for as long as one call takes: made in C and
// encrypted, or decrypted and signed with in C, and wiped. Swift hands it
// through in buffers it does not copy; what the system's own libraries copy
// inside themselves is theirs.
enum SeedStore {
  /// The record's first byte, so that a later layout is told from this one.
  private static let version: UInt8 = 1
  private static let service = "network.ararat.ark.keystore"
  private static let account = "seed"
  private static let keyTag = Data("network.ararat.ark.keystore.seed-key".utf8)
  private static let algorithm = SecKeyAlgorithm.eciesEncryptionCofactorVariableIVX963SHA256AESGCM
  /// One call that makes, opens, or removes the key at a time.
  private static let inFlight = NSLock()

  enum Protection: UInt8 {
    case none = 0
    case biometric = 1
    case passcode = 2

    var name: String {
      switch self {
      case .none: return "none"
      case .biometric: return "biometric"
      case .passcode: return "passcode"
      }
    }
  }

  enum Hardware: UInt8 {
    case software = 0
    case secureEnclave = 1

    var name: String {
      switch self {
      case .software: return "software"
      case .secureEnclave: return "secure_enclave"
      }
    }
  }

  struct Held {
    let publicKey: Data
    let protection: Protection
    let hardware: Hardware
    /// The seed as the Enclave's key encrypted it.
    let wrapped: Data
    /// Whether the Enclave's key is gone, so that nothing opens the seed again.
    let invalidated: Bool
  }

  enum Availability {
    case available(Protection)
    case unavailable(KeystoreFailure.Kind)

    var name: String {
      switch self {
      case .available(let protection): return protection.name
      case .unavailable(let kind): return kind.rawValue
      }
    }
  }

  // MARK: - What this phone can hold

  /// The protection a key made now would have, or why none can be made.
  static func availability() -> Availability {
    #if targetEnvironment(simulator)
      // The Simulator refuses every key with authentication on it, with a face enrolled or not, so a build for it
      // makes a key with none. No build for a phone holds this branch.
      return .available(.none)
    #else
      guard SecureEnclave.isAvailable else { return .unavailable(.noHardware) }
      let context = LAContext()
      var error: NSError?
      if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
        return .available(.biometric)
      }
      // Enrolled and locked out for now is still enrolled: the key is made, and signs when the lockout ends.
      if let error, error.domain == LAError.errorDomain, error.code == LAError.Code.biometryLockout.rawValue {
        return .available(.biometric)
      }
      if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) {
        return .available(.passcode)
      }
      return .unavailable(.noPasscode)
    #endif
  }

  // MARK: - The key held

  /// The key the phone holds, or nil. It asks the member for nothing.
  static func held() throws -> Held? {
    guard let record = try readRecord() else { return nil }
    guard record.count > 3 + Int(ARK_PUBLIC_KEY_LENGTH), record[record.startIndex] == version,
      let protection = Protection(rawValue: record[record.startIndex + 1]),
      let hardware = Hardware(rawValue: record[record.startIndex + 2])
    else {
      throw KeystoreFailure(.failed, "the stored key is in no layout this build reads")
    }
    let body = record.dropFirst(3)
    let publicKey = Data(body.prefix(Int(ARK_PUBLIC_KEY_LENGTH)))
    let wrapped = Data(body.dropFirst(Int(ARK_PUBLIC_KEY_LENGTH)))
    return Held(publicKey: publicKey, protection: protection, hardware: hardware, wrapped: wrapped, invalidated: try !enclaveKeyExists())
  }

  // MARK: - Making the key

  /// Makes a new seed and stores it.
  static func create() throws -> Held {
    try store { seed, memberKey in
      guard ark_keystore_generate(seed, memberKey) == 1 else {
        throw KeystoreFailure(.failed, "the system's random source gave no seed")
      }
    }
  }

  /// Stores the seed a seed phrase stands for, as a new one is stored. The seed phrase is read in C. A text that
  /// is not one is refused before anything else is asked or changed, a key already held among them.
  static func restore(seedPhrase: String) throws -> Held {
    _ = try memberKey(ofSeedPhrase: seedPhrase)
    return try store { seed, memberKey in
      let status = seedPhrase.withCString { ark_keystore_seed_from_phrase($0, seed, nil, nil) }
      guard status == ARK_SEED_PHRASE_OK, ark_keystore_public_key(seed, memberKey) == 1 else {
        throw KeystoreFailure(.invalidSeedPhrase, "the text is not a seed phrase: status \(status)")
      }
    }
  }

  /// Whether a text is the seed phrase of the key held. It opens nothing and asks nothing of the member: the public
  /// key the text gives is held against the one kept beside the encrypted seed.
  static func matches(seedPhrase: String) throws -> Bool {
    guard let held = try held(), let entered = try? memberKey(ofSeedPhrase: seedPhrase) else { return false }
    return Data(entered) == held.publicKey
  }

  /// The public key of the seed a seed phrase stands for, with the seed wiped before this returns.
  private static func memberKey(ofSeedPhrase seedPhrase: String) throws -> [UInt8] {
    var seed = [UInt8](repeating: 0, count: Int(ARK_SEED_LENGTH))
    defer { ark_keystore_wipe(&seed, seed.count) }
    var memberKey = [UInt8](repeating: 0, count: Int(ARK_PUBLIC_KEY_LENGTH))
    let status = seedPhrase.withCString { ark_keystore_seed_from_phrase($0, &seed, nil, nil) }
    guard status == ARK_SEED_PHRASE_OK, ark_keystore_public_key(&seed, &memberKey) == 1 else {
      throw KeystoreFailure(.invalidSeedPhrase, "the text is not a seed phrase: status \(status)")
    }
    return memberKey
  }

  /// Stores a seed under a new Enclave key. `fill` writes the seed and its public key into the memory it is given.
  private static func store(_ fill: (_ seed: UnsafeMutablePointer<UInt8>, _ memberKey: UnsafeMutablePointer<UInt8>) throws -> Void) throws -> Held {
    guard inFlight.try() else { throw KeystoreFailure(.failed, "another keystore call is in flight") }
    defer { inFlight.unlock() }

    if let existing = try held() {
      // A record whose Enclave key is gone opens nothing and is replaced; one whose key is there is the member's.
      guard existing.invalidated else { throw KeystoreFailure(.exists, "a key is already held, and a key is never overwritten") }
    }
    let protection: Protection
    switch availability() {
    case .available(let made): protection = made
    case .unavailable(let kind): throw KeystoreFailure(kind, "this phone can be given no key: \(kind.rawValue)")
    }

    // The seed is written in C, into memory this call owns and wipes, and is handed to the system without a copy.
    // It is had before anything is deleted or made, so that words that are no seed's change nothing.
    let seed = UnsafeMutablePointer<UInt8>.allocate(capacity: Int(ARK_SEED_LENGTH))
    defer {
      ark_keystore_wipe(seed, Int(ARK_SEED_LENGTH))
      seed.deallocate()
    }
    var memberKey = [UInt8](repeating: 0, count: Int(ARK_PUBLIC_KEY_LENGTH))
    try memberKey.withUnsafeMutableBufferPointer { buffer in
      guard let base = buffer.baseAddress else { throw KeystoreFailure(.failed, "no memory for the public key") }
      try fill(seed, base)
    }

    try deleteAll()
    let privateKey = try makeEnclaveKey(protection)
    do {
      guard let publicKey = SecKeyCopyPublicKey(privateKey), SecKeyIsAlgorithmSupported(publicKey, .encrypt, algorithm) else {
        throw KeystoreFailure(.failed, "the Secure Enclave's key does not encrypt with the scheme the keystore uses")
      }
      guard let plain = CFDataCreateWithBytesNoCopy(nil, seed, Int(ARK_SEED_LENGTH), kCFAllocatorNull) else {
        throw KeystoreFailure(.failed, "the seed could not be handed to the Secure Enclave")
      }
      var error: Unmanaged<CFError>?
      guard let wrapped = SecKeyCreateEncryptedData(publicKey, algorithm, plain, &error) as Data? else {
        throw failure("encrypting the seed", error)
      }

      #if targetEnvironment(simulator)
        let hardware = Hardware.software
      #else
        let hardware = Hardware.secureEnclave
      #endif
      var record = Data([version, protection.rawValue, hardware.rawValue])
      record.append(contentsOf: memberKey)
      record.append(wrapped)
      try writeRecord(record)
      return Held(publicKey: Data(memberKey), protection: protection, hardware: hardware, wrapped: wrapped, invalidated: false)
    } catch {
      // No Enclave key is left behind with no seed under it.
      try? deleteAll()
      throw error
    }
  }

  // MARK: - Using the seed

  /// A signature by the held key over SHA-256 of the message, after the member authenticates.
  static func sign(_ message: Data, reason: String, cancel: String) throws -> Data {
    try withSeed(reason: reason, cancel: cancel) { seed in
      var signature = [UInt8](repeating: 0, count: Int(ARK_SIGNATURE_LENGTH))
      let signed = message.withUnsafeBytes { bytes in
        ark_keystore_sign(seed, bytes.bindMemory(to: UInt8.self).baseAddress, message.count, &signature)
      }
      guard signed == 1 else { throw KeystoreFailure(.failed, "the core made no signature") }
      return Data(signature)
    }
  }

  /// The held key's 24 words, after the member authenticates, for the native view that draws them and for nothing
  /// else: no call that JavaScript can make returns them. They are written in C into a buffer that is wiped here;
  /// the strings a label needs are the one copy this side keeps, until the view clears them.
  static func seedPhrase(reason: String, cancel: String) throws -> [String] {
    try withSeed(reason: reason, cancel: cancel) { seed in
      var text = [CChar](repeating: 0, count: Int(ARK_SEED_PHRASE_SIZE))
      defer { ark_keystore_wipe(&text, text.count) }
      guard ark_keystore_seed_phrase(seed, &text) == 1 else { throw KeystoreFailure(.failed, "the core gave no words") }
      let words = String(cString: text).split(separator: " ").map(String.init)
      guard words.count == Int(ARK_WORD_COUNT) else { throw KeystoreFailure(.failed, "the core gave \(words.count) words") }
      return words
    }
  }

  /// Opens the seed for one use, after the member authenticates, and wipes it when the use returns.
  private static func withSeed<T>(reason: String, cancel: String, _ use: (UnsafePointer<UInt8>) throws -> T) throws -> T {
    guard inFlight.try() else { throw KeystoreFailure(.failed, "another keystore call is in flight") }
    defer { inFlight.unlock() }

    guard let held = try held() else { throw KeystoreFailure(.noKey, "no key is held") }

    // A context of this call's own, never authenticated before it and invalidated after it: one that was kept and
    // already authenticated would open the key again with no prompt.
    let context = LAContext()
    context.localizedReason = reason
    context.localizedCancelTitle = cancel
    defer { context.invalidate() }

    guard let privateKey = try enclaveKey(context: context) else {
      throw KeystoreFailure(.keyInvalidated, "the Secure Enclave no longer holds the key that opens the seed")
    }
    var error: Unmanaged<CFError>?
    guard let plain = SecKeyCreateDecryptedData(privateKey, algorithm, held.wrapped as CFData, &error) else {
      throw failure("opening the seed", error)
    }
    // The decrypted seed is the system's buffer, and it is wiped in place before this call returns.
    let length = CFDataGetLength(plain)
    guard let seed = CFDataGetBytePtr(plain) else { throw KeystoreFailure(.failed, "the seed opened to nothing") }
    defer { ark_keystore_wipe(UnsafeMutableRawPointer(mutating: seed), length) }
    guard length == Int(ARK_SEED_LENGTH) else { throw KeystoreFailure(.failed, "the seed opened to \(length) bytes") }
    return try use(seed)
  }

  // MARK: - Removing

  static func remove() throws {
    guard inFlight.try() else { throw KeystoreFailure(.failed, "another keystore call is in flight") }
    defer { inFlight.unlock() }
    try deleteAll()
  }

  // MARK: - The Secure Enclave's key

  private static func makeEnclaveKey(_ protection: Protection) throws -> SecKey {
    var error: Unmanaged<CFError>?
    let flags: SecAccessControlCreateFlags
    let accessible: CFString
    switch protection {
    case .biometric:
      // A fingerprint or a face alone, of those enrolled now: one added or removed invalidates the key.
      flags = [.privateKeyUsage, .biometryCurrentSet]
      accessible = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
    case .passcode:
      // The passcode, or a fingerprint or face in its place: the key outlasts an enrolment.
      flags = [.privateKeyUsage, .userPresence]
      accessible = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
    case .none:
      flags = [.privateKeyUsage]
      accessible = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    }
    guard let access = SecAccessControlCreateWithFlags(nil, accessible, flags, &error) else {
      throw failure("describing the key's protection", error)
    }
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: keyTag,
        kSecAttrAccessControl as String: access,
      ] as [String: Any],
    ]
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw failure("making the Secure Enclave's key", error)
    }
    return key
  }

  /// Whether the Keychain holds the Enclave's key. Its attributes are asked for and not the key, in a context that
  /// may show the member nothing, so that the answer is the same whatever the key would ask before it is used.
  private static func enclaveKeyExists() throws -> Bool {
    let context = LAContext()
    context.interactionNotAllowed = true
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnAttributes as String: true,
      kSecUseAuthenticationContext as String: context,
    ]
    var found: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &found)
    switch status {
    case errSecSuccess, errSecInteractionNotAllowed:
      // There, whether or not reading it would have asked something of the member.
      return true
    case errSecItemNotFound:
      return false
    default:
      throw KeystoreFailure(.failed, "looking for the Secure Enclave's key: status \(status)")
    }
  }

  /// The Enclave's key, bound to the context its use will authenticate in, or nil when the Keychain holds none.
  private static func enclaveKey(context: LAContext) throws -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
      kSecUseAuthenticationContext as String: context,
    ]
    var found: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &found)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let found, CFGetTypeID(found) == SecKeyGetTypeID() else {
      throw KeystoreFailure(.failed, "looking up the Secure Enclave's key: status \(status)")
    }
    // The type was checked on the line above.
    return (found as! SecKey)
  }

  // MARK: - The record in the Keychain

  private static var recordQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func readRecord() throws -> Data? {
    var query = recordQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var found: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &found)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = found as? Data else {
      throw KeystoreFailure(.failed, "reading the stored key: status \(status)")
    }
    return data
  }

  private static func writeRecord(_ record: Data) throws {
    var item = recordQuery
    item[kSecValueData as String] = record
    // On this device alone: it is in no backup and on no other device, where the Enclave's key would not be.
    item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeystoreFailure(.failed, "storing the key: status \(status)") }
  }

  private static func deleteAll() throws {
    let key: [String: Any] = [kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: keyTag]
    for query in [recordQuery, key] {
      let status = SecItemDelete(query as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        throw KeystoreFailure(.failed, "removing the key: status \(status)")
      }
    }
  }

  // MARK: - What a failure means

  /// A failure of the system's, by the kind the app acts on where it has one, with the system's own words kept.
  private static func failure(_ doing: String, _ error: Unmanaged<CFError>?) -> KeystoreFailure {
    guard let error = error?.takeRetainedValue() else { return KeystoreFailure(.failed, "\(doing): no reason given") }
    let top = error as Error as NSError
    var kind = KeystoreFailure.Kind.failed
    var current: NSError? = top
    // The reason is sometimes the error and sometimes under it: the first that says something decides.
    while let each = current, kind == .failed {
      kind = self.kind(domain: each.domain, code: each.code)
      current = each.userInfo[NSUnderlyingErrorKey] as? NSError
    }
    return KeystoreFailure(kind, "\(doing): \(top.domain) \(top.code): \(top.localizedDescription)")
  }

  private static func kind(domain: String, code: Int) -> KeystoreFailure.Kind {
    if domain == LAError.errorDomain, let reason = LAError.Code(rawValue: code) {
      switch reason {
      case .biometryLockout:
        return .lockedOut
      case .userCancel, .systemCancel, .appCancel, .authenticationFailed, .userFallback, .biometryNotAvailable, .notInteractive:
        return .authenticationFailed
      case .biometryNotEnrolled, .passcodeNotSet:
        // What the key was made to ask for is no longer on the phone.
        return .keyInvalidated
      default:
        return .failed
      }
    }
    if domain == NSOSStatusErrorDomain {
      switch OSStatus(truncatingIfNeeded: code) {
      case errSecUserCanceled, errSecAuthFailed: return .authenticationFailed
      case errSecItemNotFound: return .keyInvalidated
      default: return .failed
      }
    }
    return .failed
  }
}

/// Why a keystore call did not do what it was asked, by the kind JavaScript reads from its code.
struct KeystoreFailure: Error {
  enum Kind: String {
    case noPasscode = "no_passcode"
    case noHardware = "no_hardware"
    case exists
    case noKey = "no_key"
    case authenticationFailed = "authentication_failed"
    case lockedOut = "locked_out"
    case keyInvalidated = "key_invalidated"
    case screenCaptured = "screen_captured"
    case invalidSeedPhrase = "invalid_seed_phrase"
    case failed
  }

  let kind: Kind
  let reason: String

  init(_ kind: Kind, _ reason: String) {
    self.kind = kind
    self.reason = reason
  }
}
