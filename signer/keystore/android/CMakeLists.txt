# Builds the keystore's C core, the one iOS compiles too, with libsecp256k1
# from the source kept beside it and the JNI entry Kotlin calls. The command
# line in ../native/test is the host tests' and is never built here.
cmake_minimum_required(VERSION 3.16)
project(arkkeystore C)

set(CORE ../native)

set(OURS
  ${CORE}/ark_sha2.c
  ${CORE}/ark_keystore.c
  ${CORE}/ark_self_check.c
  src/main/cpp/jni.c
)

set(SECP256K1
  ${CORE}/secp256k1/src/secp256k1.c
  ${CORE}/secp256k1/src/precomputed_ecmult.c
  ${CORE}/secp256k1/src/precomputed_ecmult_gen.c
)

add_library(arkkeystore SHARED ${OURS} ${SECP256K1})

target_include_directories(arkkeystore PRIVATE ${CORE} ${CORE}/secp256k1/include ${CORE}/secp256k1/src)

# Ours with every warning an error; the library as its authors build it, with its warnings its own.
set_source_files_properties(${OURS} PROPERTIES COMPILE_OPTIONS "-Wall;-Wextra;-Werror")
set_source_files_properties(${SECP256K1} PROPERTIES COMPILE_OPTIONS "-w")
