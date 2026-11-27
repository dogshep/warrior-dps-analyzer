#!/usr/bin/env bash
# Builds the wowsims/forever warrior sim to WebAssembly and copies the data the page needs into web/sim/.
# Usage: scripts/build-sim.sh [git-ref]   (default: the commit in SIM_REF)
# WOWSIMS_DIR reuses an existing wowsims checkout; SKIP_FETCH=1 builds it as it is checked out.
# SKIP_UPGRADES=1 skips the slow gear ranking (scripts/precompute-upgrades.mjs) for the upgrades section.
# Needs: git, Go (the version in wowsims/forever's go.mod), python3 with grpcio-tools, protoc-gen-go, Node 22.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="${1:-$(tr -d '[:space:]' < "$ROOT/SIM_REF")}"
WORK="${WOWSIMS_DIR:-$ROOT/.wowsims}"
OUT="$ROOT/web/sim"

if [ ! -d "$WORK/.git" ]; then
  GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --branch "$REF" https://github.com/wowsims/forever "$WORK" \
    || { GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/wowsims/forever "$WORK" && git -C "$WORK" checkout "$REF"; }
elif [ -z "${SKIP_FETCH:-}" ]; then
  git -C "$WORK" fetch --depth 1 origin "$REF" && git -C "$WORK" checkout -q FETCH_HEAD
fi

cd "$WORK"
# Everything below runs inside the wowsims checkout. Stop Python from importing modules from the current
# directory (a stray json.py or grpc_tools/ there would otherwise run instead of the real one).
export PYTHONSAFEPATH=1
# protoc-gen-go at the same version as the protobuf module wowsims builds against, not @latest.
PROTOBUF_VERSION="$(go list -m -f '{{.Version}}' google.golang.org/protobuf)"
command -v protoc-gen-go >/dev/null || go install "google.golang.org/protobuf/cmd/protoc-gen-go@$PROTOBUF_VERSION"
export PATH="$PATH:$(go env GOPATH)/bin"
INC="$(python3 -c 'import grpc_tools,os;print(os.path.join(os.path.dirname(grpc_tools.__file__),"_proto"))')"
python3 -m grpc_tools.protoc -I=./proto -I="$INC" \
  --go_opt=Mgoogle/protobuf/descriptor.proto=google.golang.org/protobuf/types/descriptorpb \
  --go_out=./sim/core ./proto/*.proto

mkdir -p "$OUT/apls" "$OUT/gear_sets"
GOOS=js GOARCH=wasm go build -tags=with_db -ldflags "-w -s" -o "$OUT/lib.wasm" ./sim/wasm/
gzip -9 -f -n "$OUT/lib.wasm"
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$OUT/wasm_exec.js" 2>/dev/null || cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" "$OUT/wasm_exec.js"
cp ui/specs/warrior/dps/apls/*.json "$OUT/apls/"
cp ui/specs/warrior/dps/gear_sets/*.json "$OUT/gear_sets/"
python3 -I "$ROOT/scripts/make_names.py" assets/database/db.json "$OUT/names.json"
python3 -I - "$OUT/version.json" <<PY
import json,subprocess,sys,datetime
sha=subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()
date=subprocess.check_output(["git","log","-1","--format=%cI"],text=True).strip()
json.dump({"repo":"wowsims/forever","commit":sha,"commitDate":date,"builtAt":datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")},open(sys.argv[1],"w"),indent=1)
PY
# The ranked item list behind "Gear upgrades" (about 14 minutes on 4 cores). SKIP_UPGRADES=1 leaves it out.
if [ -z "${SKIP_UPGRADES:-}" ]; then
  node "$ROOT/scripts/precompute-upgrades.mjs" assets/database/db.json "$OUT"
fi
echo "Built sim from wowsims/forever $(git rev-parse --short HEAD) into $OUT"
