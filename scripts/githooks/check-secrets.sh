#!/bin/bash
# Shared secret scanner for pre-commit and pre-push. This repo is PUBLIC.
# Usage: check-secrets.sh <git diff args...>   (e.g. --cached, or A..B)
# Checks: (1) secret-looking file names, (2) credential-looking lines,
#         (3) any real value from the server-side secrets file(s).
SECRETS_DIR="${ARTHISTORY_SECRETS_DIR:-$HOME/.config/arthistory}"
fail=0

while IFS= read -r f; do
  case "$(basename "$f")" in
    .env.example) ;;
    .env|.env.*|*.env|*.pem|*.key|*.p12|id_rsa*|id_ed25519*|htpasswd|*.htpasswd)
      echo "✗ secret-looking file: $f"; fail=1 ;;
  esac
done < <(git diff --name-only --diff-filter=ACMR "$@")

added=$(git diff -U0 --diff-filter=ACMR "$@" -- . ':!*.example' ':!scripts/githooks/*' | grep -E '^\+[^+]' || true)

if grep -iqE '(password|passwd|secret|api_?key|token|private_?key)[A-Za-z_]*\s*[=:]\s*["'"'"']?[A-Za-z0-9/+_\-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY|\$2[aby]\$[0-9]{2}\$' <<<"$added"; then
  echo "✗ changes contain a credential-looking line (password/token/key/bcrypt hash)"; fail=1
fi

for envf in "$SECRETS_DIR"/*.env; do
  [ -f "$envf" ] || continue
  while IFS='=' read -r key val; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    [ ${#val} -lt 6 ] && continue
    case "$val" in localhost|127.0.0.1|production|development|true|false) continue ;; esac
    if grep -qF -- "$val" <<<"$added"; then
      echo "✗ changes contain the real value of $key from $(basename "$envf")"; fail=1
    fi
  done < "$envf"
done

[ $fail -ne 0 ] && echo "  Blocked: secrets belong only in $SECRETS_DIR (never in the repo)."
exit $fail
