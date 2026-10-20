#!/usr/bin/env bash
# Fetches the PUBLIC LGD detail and version-history page of every district in the official All Districts report
# (Milestone 2.4 Stage 3a, approval L). Raw pages go OUTSIDE Git; a JSONL log keeps url, status, size, SHA-256 and
# retrieval time for every request.
#
#   bash docs/geography/fetch_district_history.sh <reference-data-dir> <codes-file>
#
# Rules: honest User-Agent; one request per second; resumes (skips pages already saved); STOPS at the first
# non-200 answer or any page that mentions a CAPTCHA; no authentication, no CAPTCHA, no API key is used.
set -uo pipefail
RD="${1:?reference data dir}"; CODES="${2:?file with one district code per line}"
UA="FASALYTICS-reference-audit/1.0 (research)"
LGD="https://lgdirectory.gov.in"
OUT="$RD/raw/lgd/district_pages"; LOG="$RD/raw/lgd/district_pages_fetch_log.jsonl"
mkdir -p "$OUT"; CJ="$RD/raw/pages/.session_fetch.txt"; trap 'rm -f "$CJ"' EXIT
session() { rm -f "$CJ"; curl -s -L -m 60 -A "$UA" -c "$CJ" -o "$OUT/.home.tmp" "$LGD/" && TOK=$(grep -o "OWASP_CSRFTOKEN=[A-Z0-9-]*" "$OUT/.home.tmp" | head -1); rm -f "$OUT/.home.tmp"; }
session; n=0
while read -r code; do
  code=$(echo "$code" | tr -d '\r'); [ -z "$code" ] && continue
  for kind in detail history; do
    f="$OUT/district_${code}_${kind}.html"; [ -s "$f" ] && continue
    if [ "$kind" = detail ]; then ep="globalviewDistrictDetail.do?globaldistrictId=$code"; else ep="viewDistrictHistoryReport.do?globaldistrictId=$code"; fi
    url="$LGD/$ep"
    st=$(curl -s -L -m 40 -A "$UA" -b "$CJ" -c "$CJ" -o "$f" -w "%{http_code}" "$url&$TOK")
    ts=$(date -u +%FT%TZ); size=$(stat -c%s "$f" 2>/dev/null || echo 0); sha=$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)
    printf '{"url":"%s","http_status":%s,"bytes":%s,"sha256":"%s","retrieved_utc":"%s","file":"raw/lgd/district_pages/%s"}\n' "$url" "$st" "$size" "$sha" "$ts" "$(basename "$f")" >> "$LOG"
    if [ "$st" != "200" ] || { grep -qi "captcha" "$f" && ! grep -q "District Code\|History Details" "$f"; }; then echo "STOP: $url -> $st (or a CAPTCHA page)"; rm -f "$f"; exit 3; fi
    sleep 1
  done
  n=$((n+1)); [ $((n % 100)) -eq 0 ] && { echo "$n districts done $(date -u +%T)"; session; }
done < "$CODES"
echo "finished: $n districts"
