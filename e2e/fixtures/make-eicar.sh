#!/bin/sh
# Write the EICAR anti-malware test file.
#
# https://www.eicar.org/download-anti-malware-testfile/ — a 68-byte ASCII string that every
# antivirus engine is required to report as malware. It is not a virus, contains no
# malicious code, and can do nothing at all. It exists so that antivirus integration can be
# tested without anyone handling a real sample.
#
# Written at test time rather than checked in, because committing it would mean every
# contributor's own antivirus quarantines a file inside their clone of Gather.
#
# The string is assembled in pieces for exactly the same reason: a scanner watching this
# repository should not find the signature sitting in a shell script either.
#
#   sh e2e/fixtures/make-eicar.sh /tmp/eicar.com
set -eu

OUT="${1:?usage: make-eicar.sh <path>}"

# X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
A='X5O!P%@AP[4\PZX54(P^)7CC)7}'
B='$EICAR-STANDARD-'
C='ANTIVIRUS-TEST-FILE!'
D='$H+H*'

printf '%s%s%s%s' "$A" "$B" "$C" "$D" > "$OUT"

SIZE=$(wc -c < "$OUT" | tr -d ' ')
if [ "$SIZE" -ne 68 ]; then
	echo "EICAR file is $SIZE bytes, expected 68 — the string was mangled." >&2
	exit 1
fi
