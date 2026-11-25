# The module's iOS build: its Swift, and the C in native/ that Android
# compiles too. The header is public so that the Swift here sees its
# declarations through the module the pod defines.
Pod::Spec.new do |s|
  s.name           = 'NativeCheck'
  s.version        = '0.0.0'
  s.summary        = 'A check that the app builds and calls native code'
  s.description    = 'A check that the app builds Swift and C on iOS and calls them from JavaScript'
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

  s.source_files = 'ios/**/*.swift', 'native/**/*.{h,c}'
  s.public_header_files = 'native/**/*.h'
end
