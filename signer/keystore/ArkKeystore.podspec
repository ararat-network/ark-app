# The keystore's iOS build: its Swift, the C core in native/, and libsecp256k1
# compiled from the source kept beside it. The core's one public header is
# what the Swift here sees; every other header stays inside the pod, so the
# library's own, with names as plain as util.h, reach no other pod.
Pod::Spec.new do |s|
  s.name           = 'ArkKeystore'
  s.version        = '0.0.0'
  s.summary        = 'The Ark signer\'s device keystore'
  s.description    = 'The Ark signer\'s device keystore: the key derived and used in C, behind Swift'
  s.author         = 'Ararat Network'
  s.homepage       = 'https://github.com/ararat-network/ark-app'
  s.license        = 'Apache-2.0'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # native/test is the command line the host tests build, which takes private keys as arguments: never compiled here.
  s.source_files = 'ios/**/*.swift', 'native/*.{h,c}', 'native/secp256k1/include/*.h', 'native/secp256k1/src/*.{h,c}'
  s.public_header_files = 'native/ark_keystore.h'
  s.project_header_files = 'native/ark_sha2.h', 'native/ark_keystore_internal.h', 'native/ark_bip39_english.h', 'native/secp256k1/**/*.h'
end
