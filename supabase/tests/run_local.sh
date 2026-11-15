#!/usr/bin/env bash
# স্থানীয় PostgreSQL এ migration ও নিরাপত্তা-পরীক্ষা চালায়
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
WORK="${TMPDIR:-/tmp}/report-metro-pg"
SOCK="$(mktemp -d /tmp/rmpg.XXXX)"   # সকেটের পথ ছোট রাখতে হয় (১০৭ অক্ষর সীমা)
rm -rf "$WORK"; mkdir -p "$WORK"
$PGBIN/initdb -D "$WORK/data" -U postgres -A trust >/dev/null
$PGBIN/pg_ctl -D "$WORK/data" -o "-k $SOCK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
trap '$PGBIN/pg_ctl -D "$WORK/data" -m fast stop >/dev/null; rm -rf "$SOCK"' EXIT
P="psql -h $SOCK -U postgres -v ON_ERROR_STOP=1 -q"
$P -c 'create database t' >/dev/null
$P -d t -f "$HERE/supabase_mock.sql" >/dev/null
for f in "$HERE"/../migrations/*.sql; do $P -d t -f "$f" >/dev/null; done
$P -t -d t -f "$HERE/security_test.sql" 2>&1 | grep -E "PASS|FAIL|ERROR|সব পরীক্ষা" | sed "s/^psql:[^ ]* NOTICE:  //"
