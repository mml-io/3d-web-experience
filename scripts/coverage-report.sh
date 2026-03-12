#!/usr/bin/env bash
#
# Runs all tests and prints a single coverage summary table.
# Usage: npm run coverage-report
#
set -o pipefail

OUTPUT=$(npm run test-all 2>&1)
EXIT_CODE=$?

# Arrays to hold per-package data
declare -a PKGS S_PCT B_PCT F_PCT L_PCT S_COV S_TOT B_COV B_TOT F_COV F_TOT L_COV L_TOT
IDX=0
CUR_PKG=""

while IFS= read -r line; do
  if echo "$line" | grep -q "Coverage summary"; then
    # Extract package name from "pkgname:test: === Coverage..."
    CUR_PKG=$(echo "$line" | sed 's/:test:.*//' | sed 's/^@mml-io\///' | sed 's/^ *//')
    PKGS[$IDX]="$CUR_PKG"
    continue
  fi

  if [ -z "$CUR_PKG" ]; then continue; fi

  # Extract percentage and fraction from lines like:
  # "pkgname:test: Statements   : 61.67% ( 845/1370 )"
  pct=$(echo "$line" | grep -oE '[0-9.]+%' | head -1)
  cov=$(echo "$line" | grep -oE '\( *[0-9]+/' | grep -oE '[0-9]+')
  tot=$(echo "$line" | grep -oE '/[0-9]+ *\)' | grep -oE '[0-9]+')

  if echo "$line" | grep -q "Statements"; then
    S_PCT[$IDX]="$pct"
    S_COV[$IDX]="$cov"
    S_TOT[$IDX]="$tot"
  elif echo "$line" | grep -q "Branches"; then
    B_PCT[$IDX]="$pct"
    B_COV[$IDX]="$cov"
    B_TOT[$IDX]="$tot"
  elif echo "$line" | grep -q "Functions"; then
    F_PCT[$IDX]="$pct"
    F_COV[$IDX]="$cov"
    F_TOT[$IDX]="$tot"
  elif echo "$line" | grep -q "Lines "; then
    L_PCT[$IDX]="$pct"
    L_COV[$IDX]="$cov"
    L_TOT[$IDX]="$tot"
    IDX=$((IDX + 1))
    CUR_PKG=""
  fi
done <<< "$OUTPUT"

# Print table
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  COVERAGE REPORT"
echo "═══════════════════════════════════════════════════════════════════════════════"
printf "  %-40s %10s %10s %10s %10s\n" "Package" "Stmts" "Branch" "Funcs" "Lines"
echo "  ────────────────────────────────────────────────────────────────────────────"

TSCOV=0; TSTOT=0; TBCOV=0; TBTOT=0; TFCOV=0; TFTOT=0; TLCOV=0; TLTOT=0

for ((i=0; i<IDX; i++)); do
  printf "  %-40s %10s %10s %10s %10s\n" \
    "${PKGS[$i]}" "${S_PCT[$i]}" "${B_PCT[$i]}" "${F_PCT[$i]}" "${L_PCT[$i]}"
  TSCOV=$((TSCOV + ${S_COV[$i]:-0}))
  TSTOT=$((TSTOT + ${S_TOT[$i]:-0}))
  TBCOV=$((TBCOV + ${B_COV[$i]:-0}))
  TBTOT=$((TBTOT + ${B_TOT[$i]:-0}))
  TFCOV=$((TFCOV + ${F_COV[$i]:-0}))
  TFTOT=$((TFTOT + ${F_TOT[$i]:-0}))
  TLCOV=$((TLCOV + ${L_COV[$i]:-0}))
  TLTOT=$((TLTOT + ${L_TOT[$i]:-0}))
done

echo "  ────────────────────────────────────────────────────────────────────────────"

if [ "$TSTOT" -gt 0 ]; then
  PS=$(awk "BEGIN{printf \"%.1f%%\", ($TSCOV/$TSTOT)*100}")
  PB=$(awk "BEGIN{printf \"%.1f%%\", ($TBCOV/$TBTOT)*100}")
  PF=$(awk "BEGIN{printf \"%.1f%%\", ($TFCOV/$TFTOT)*100}")
  PL=$(awk "BEGIN{printf \"%.1f%%\", ($TLCOV/$TLTOT)*100}")
  printf "  %-40s %10s %10s %10s %10s\n" \
    "TOTAL ($TSCOV/$TSTOT)" "$PS" "$PB" "$PF" "$PL"
fi

echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

exit $EXIT_CODE
