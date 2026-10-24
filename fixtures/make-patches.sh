#!/bin/sh
# 各フィクスチャの before.md / after.md から diff.patch を再生成する
cd "$(dirname "$0")"
for d in */; do
  d=${d%/}
  (cd "$d" && git diff --no-index --no-color --no-ext-diff --no-textconv -U3 before.md after.md > diff.patch)
done
exit 0
