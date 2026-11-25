// The native module's typed face. `reverse` hands bytes to the C that Swift
// and Kotlin both call, and returns them reversed. The module is null in a
// build that does not have it, so a screen can say so and not fail to load.
import { type NativeModule, requireOptionalNativeModule } from "expo";

declare class NativeCheckModule extends NativeModule {
  reverse(input: Uint8Array): Uint8Array;
}

export default requireOptionalNativeModule<NativeCheckModule>("NativeCheck");
