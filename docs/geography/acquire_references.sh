#!/usr/bin/env bash
# Reproduces the Milestone 2.4 Stage 2 acquisition of OFFICIAL reference material.
#
#   bash docs/geography/acquire_references.sh [target-directory]
#
# Rules (see REFERENCE_ACQUISITION_PROCEDURE.md):
#  - raw files go OUTSIDE Git (default: ../AgriSupply-IQ-reference-data next to the repository);
#  - an honest User-Agent; no CAPTCHA, login, API key or account is used or bypassed;
#  - only state-level LGD pages and the eNAM directory are fetched (no village/ward/local-body data);
#  - nothing is written to any database.
# The districts file and the LGD modification list sit behind a CAPTCHA: they are NOT fetched here.
# See "Manual steps" in the procedure document.
set -euo pipefail

RD="${1:-$(cd "$(dirname "$0")/../../.." && pwd)/AgriSupply-IQ-reference-data}"
UA="FASALYTICS-reference-audit/1.0 (research)"
LGD="https://lgdirectory.gov.in"
mkdir -p "$RD/raw/pages" "$RD/raw/lgd/state_pages" "$RD/raw/enam" "$RD/derived"
cd "$RD/raw/pages"
CJ="$RD/raw/pages/.session.txt"   # session cookie jar; deleted at the end, never kept
trap 'rm -f "$CJ"' EXIT

fetch() { curl -sS -L -m 90 -A "$UA" -b "$CJ" -c "$CJ" -o "$2" -w "%{http_code} %{size_download}B  $1\n" "$1"; }

# 1. LGD public pages (the site hands out a session and per-link CSRF tokens; take links from the page itself)
fetch "$LGD/" lgd_home.html
link() { grep -o "href=\"$1[^\"]*\"" lgd_home.html | head -1 | sed 's/^href="//; s/"$//; s/&amp;/\&/g'; }
for page in termsconditions copyRightPolicy privacyPolicy globalviewstateforcitizen getLgdRecentModifications downloadDirectory; do
  fetch "$LGD/$(link "$page.do")" "lgd_$page.html"
done

# 2. Per-state detail and version-history pages (36 states/UTs, ~0.7 MB in total, 1 s apart)
TOK=$(grep -o "OWASP_CSRFTOKEN=[A-Z0-9-]*" lgd_globalviewstateforcitizen.html | head -1)
CODES=$(grep -o "viewEntityDetailsInPopup('[0-9]*', 'globalviewStateDetail.do'" lgd_globalviewstateforcitizen.html | grep -o "[0-9]\+" | sort -un)
cd "$RD/raw/lgd/state_pages"
for c in $CODES; do
  fetch "$LGD/globalviewStateDetail.do?globalstateId=$c&$TOK" "state_${c}_detail.html"  >/dev/null
  fetch "$LGD/viewStateHistoryReport.do?globalstateId=$c&$TOK" "state_${c}_history.html" >/dev/null
  sleep 1
done

# 3. eNAM directory (11.1 MB). The working path is the relative link published on the eNAM site;
#    the /web/assest/... form returns an HTML page shell instead of the PDF.
cd "$RD/raw/enam"
fetch "https://enam.gov.in/assest/download/eNAM_Directory_20210720.pdf" eNAM_Directory_20210720.pdf
head -c 5 eNAM_Directory_20210720.pdf | grep -q '%PDF-' || { echo "not a PDF - stop"; exit 1; }

# 4. Hash everything that was acquired
cd "$RD" && find raw -type f ! -name '.session.txt' -print0 | sort -z | xargs -0 sha256sum > derived/SHA256SUMS.txt
echo "done: $(wc -l < derived/SHA256SUMS.txt) files hashed in $RD/derived/SHA256SUMS.txt"
