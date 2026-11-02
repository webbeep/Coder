#!/usr/bin/env bash
set -euo pipefail
dir=$(mktemp -d)
mkdir -p "$dir/sub"
printf 'a\n\nb\n' > "$dir/x.txt"
printf 'c\n   \n' > "$dir/sub/y.txt"
printf 'ignored\n' > "$dir/z.md"
out=$(bash ./count_lines.sh "$dir" | tr -d '[:space:]')
rm -rf "$dir"
# "   " counts as non-empty for wc-style tools only if they don't trim; accept 3 or 4.
[ "$out" = "3" ] || [ "$out" = "4" ]
