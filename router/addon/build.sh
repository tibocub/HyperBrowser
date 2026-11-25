#!/bin/sh
# Usage: build.sh <i2pd-src> <deps (vcpkg installed/<triplet>)> <node-api headers dir> <out dir>
# Linux and macOS; needs a C++20 compiler, CMake and Ninja.
set -e
cmake -S "$(dirname "$0")" -B "$4" -G Ninja -DCMAKE_BUILD_TYPE=Release -DI2PD_SRC="$1" -DDEPS="$2" -DNODE_INC="$3"
cmake --build "$4"
