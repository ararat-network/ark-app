# Builds the C that iOS compiles too, with the JNI entry Kotlin calls.
cmake_minimum_required(VERSION 3.16)
project(arknativecheck C)

add_library(arknativecheck SHARED
  ../native/ark_check.c
  src/main/cpp/jni.c
)

target_include_directories(arknativecheck PRIVATE ../native)
target_compile_options(arknativecheck PRIVATE -Wall -Wextra -Werror)
