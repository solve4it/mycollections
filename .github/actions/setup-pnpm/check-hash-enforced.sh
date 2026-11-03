#!/usr/bin/env bash
# Proves the pnpm on PATH refuses a `packageManager` whose sha512 does not
# match (#391). Run from the repo root.
#
# The real pin is copied into a scratch package.json with its hash changed, and
# `pnpm -v` must fail with Corepack's "Mismatch hashes". Two details matter:
#
# - COREPACK_HOME is a fresh directory, because Corepack only verifies a
#   download — a version already in its cache runs whatever the pin says.
# - The failure is matched on the message, not just a non-zero exit, because a
#   network or registry error exits non-zero too and would prove nothing.
set -euo pipefail

pin=$(node -p 'require("./package.json").packageManager')
case "$pin" in
  *+sha512.*) ;;
  *)
    echo "::error::packageManager carries no sha512 to enforce: $pin"
    exit 1
    ;;
esac

hash=${pin##*+sha512.}
# Change the first hex digit, to one it certainly is not.
if [ "${hash:0:1}" = "0" ]; then bad="f${hash:1}"; else bad="0${hash:1}"; fi
tampered="${pin%%+sha512.*}+sha512.${bad}"

dir=$(mktemp -d)
printf '{"name":"tampered","private":true,"packageManager":"%s"}\n' "$tampered" > "$dir/package.json"

set +e
out=$(cd "$dir" && COREPACK_HOME="$(mktemp -d)" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm -v 2>&1)
status=$?
set -e

if [ "$status" -ne 0 ] && grep -q "Mismatch hashes" <<<"$out"; then
  echo "ok: pnpm refused a packageManager with a tampered sha512"
  exit 0
fi

if [ "$status" -eq 0 ]; then
  echo "::error::pnpm ran with a tampered packageManager sha512 — the pin is not being enforced"
else
  echo "::error::pnpm exited $status without Corepack's 'Mismatch hashes', so this run could not prove the pin is enforced (a network or registry error?)"
fi
echo "$out"
exit 1
