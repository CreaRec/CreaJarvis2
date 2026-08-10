#!/usr/bin/env bash
# Host unit tests for header-only FSM / goodbye / base64 (no ESP toolchain).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CXX="${CXX:-c++}"
"$CXX" -std=c++17 -O0 -g -Wall -Wextra \
  -I"$ROOT/components/jarvis_gateway" \
  "$ROOT/host_tests/test_logic.cpp" \
  -o "$ROOT/host_tests/test_logic"
"$ROOT/host_tests/test_logic"
echo "host_tests OK"
