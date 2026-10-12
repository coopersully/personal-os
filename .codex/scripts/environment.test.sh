#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"

bash -n "$ROOT/.codex/scripts/environment.sh"
grep -Fq 'compose-runtime-manager.mjs' "$ROOT/.codex/scripts/environment.sh"
grep -Fq 'docker compose' "$ROOT/.codex/scripts/environment.sh"
if grep -Eq 'runtime tier|reaper-enable|active-root' "$ROOT/.codex/scripts/environment.sh"; then
  printf 'legacy tier lifecycle remains in environment.sh\n' >&2
  exit 1
fi

printf 'environment lifecycle contract passed\n'

# Real local remotes exercise setup without network credentials or changing this checkout.
SETUP_SCRIPT="$ROOT/.codex/scripts/setup-main.sh"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=Test GIT_COMMITTER_NAME=Test
export GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_EMAIL=test@example.com

git init -q --bare "$SANDBOX/origin.git"
git init -q -b main "$SANDBOX/source"
cd "$SANDBOX/source"
git remote add origin "$SANDBOX/origin.git"
printf 'first\n' > tracked.txt
git add tracked.txt
git commit -qm first
git push -q origin main
git clone -q -b main "$SANDBOX/origin.git" "$SANDBOX/checkout"
git -C "$SANDBOX/checkout" checkout -q --detach
printf 'second\n' >> tracked.txt
git commit -qam second
git push -q origin main
EXPECTED="$(git rev-parse HEAD)"
cd "$SANDBOX/checkout"
bash "$SETUP_SCRIPT"
[[ "$(git rev-parse HEAD)" == "$EXPECTED" ]]
if git symbolic-ref -q HEAD; then exit 1; fi
bash "$SETUP_SCRIPT" # Idempotent.

mkdir "$(git rev-parse --git-path rebase-merge)"
if bash "$SETUP_SCRIPT"; then exit 1; fi
rmdir "$(git rev-parse --git-path rebase-merge)"
[[ "$(git rev-parse HEAD)" == "$EXPECTED" ]]

printf 'local\n' >> tracked.txt
if bash "$SETUP_SCRIPT"; then exit 1; fi
[[ "$(git rev-parse HEAD)" == "$EXPECTED" ]]
git checkout -- tracked.txt
printf 'untracked\n' > local.txt
if bash "$SETUP_SCRIPT"; then exit 1; fi
rm local.txt

git switch -qc cooper/test
printf 'local commit\n' >> tracked.txt
git commit -qam local
LOCAL_HEAD="$(git rev-parse HEAD)"
if bash "$SETUP_SCRIPT"; then exit 1; fi
[[ "$(git rev-parse HEAD)" == "$LOCAL_HEAD" ]]

git switch -q main
bash "$SETUP_SCRIPT"
[[ "$(git branch --show-current)" == main ]]
[[ "$(git rev-parse HEAD)" == "$EXPECTED" ]]
git remote set-url origin "$SANDBOX/missing.git"
if bash "$SETUP_SCRIPT"; then exit 1; fi
[[ "$(git rev-parse HEAD)" == "$EXPECTED" ]]
printf 'latest-main setup behavior passed\n'

# Exercise the real Git SSH transport selection without a network connection.
cat > "$SANDBOX/ssh-probe" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$SSH_ARGUMENT_LOG"
exit 1
SH
chmod +x "$SANDBOX/ssh-probe"
export SSH_ARGUMENT_LOG="$SANDBOX/ssh-arguments"
git remote set-url origin git@example.invalid:repo.git
git config core.sshCommand "$SANDBOX/ssh-probe -i configured-key"
if bash "$SETUP_SCRIPT"; then exit 1; fi
grep -Fxq 'configured-key' "$SSH_ARGUMENT_LOG"
grep -Fxq 'BatchMode=yes' "$SSH_ARGUMENT_LOG"
grep -Fxq 'ConnectTimeout=15' "$SSH_ARGUMENT_LOG"
grep -Fxq 'ServerAliveInterval=15' "$SSH_ARGUMENT_LOG"
grep -Fxq 'ServerAliveCountMax=3' "$SSH_ARGUMENT_LOG"
[[ "$(git rev-parse HEAD)" == "$EXPECTED" ]]
printf 'noninteractive SSH setup behavior passed\n'

for override in '-o BatchMode=no' '-o bAtChMoDe=yes' '-o ConnectTimeout=0' '-o ServerAliveInterval=0' '-o sErVeRaLiVeCoUnTmAx=99'; do
  rm -f "$SSH_ARGUMENT_LOG"
  if GIT_SSH_COMMAND="$SANDBOX/ssh-probe $override" bash "$SETUP_SCRIPT"; then exit 1; fi
  [[ ! -e "$SSH_ARGUMENT_LOG" ]]
  [[ "$(git rev-parse HEAD)" == "$EXPECTED" ]]
done
printf 'SSH safety override rejection passed\n'
