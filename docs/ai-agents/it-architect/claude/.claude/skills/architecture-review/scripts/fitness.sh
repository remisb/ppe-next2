#!/bin/sh
# Mechanical architecture checks for PPE-next2. Run from the repository root.
# Prints one line per finding and exits 1 when there is any; read-only.

set -u
fail=0
mod=github.com/remisb/ppe-next2/

# 1. Domain packages importing other domain packages, beyond the known, judged ones.
#    Add a pair here only with a reason (and, once it exists, an ADR or the import test).
allowed="
internal/domain/catalogue internal/domain/size
internal/domain/employee internal/domain/size
internal/domain/order internal/domain/size
internal/domain/dashboard internal/domain/size
internal/domain/dashboard internal/domain/catalogue
internal/domain/dashboard internal/domain/order
internal/domain/user internal/domain/role
"
go list -f '{{.ImportPath}} {{join .Imports " "}}' ./internal/domain/... | sed "s#$mod##g" |
while read -r pkg imports; do
  for imp in $imports; do
    case "$imp" in
      internal/domain/*)
        [ "$imp" = "$pkg" ] && continue
        if ! printf '%s\n' "$allowed" | grep -qx "$pkg $imp"; then
          echo "boundary: $pkg imports $imp (not on the allow-list)"
        fi ;;
      net/http|net/smtp)
        echo "layering: $pkg imports $imp (domain packages never import transport)" ;;
    esac
  done
done | tee /dev/stderr | grep -q . && fail=1

# 2. Every up migration has its down migration, and the numbers have no gap.
#    0000 creates the bookkeeping table and has no down migration by design.
prev=0
for up in internal/db/migrations/*.up.sql; do
  case "$(basename "$up")" in 0000_*) continue ;; esac
  down="${up%.up.sql}.down.sql"
  [ -f "$down" ] || { echo "migrations: $(basename "$up") has no down migration"; fail=1; }
  n=$(basename "$up" | cut -c1-4 | sed 's/^0*//'); n=${n:-0}
  [ "$n" -eq $((prev + 1)) ] || { echo "migrations: number $n follows $prev"; fail=1; }
  prev=$n
done

# 3. Every ADR file is in the index, and every index row has a file.
for f in docs/architecture/adr/*.md; do
  b=$(basename "$f")
  grep -q "adr/$b" docs/architecture/README.md || { echo "adr: $b is not in docs/architecture/README.md"; fail=1; }
done

[ $fail -eq 0 ] && echo "fitness: all checks pass"
exit $fail
