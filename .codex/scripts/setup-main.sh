#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(git rev-parse --show-toplevel)"
die() { printf '[personal-os] setup: %s\n' "$*" >&2; exit 1; }

[[ -z "$(git status --porcelain --untracked-files=normal)" ]] ||
  die 'Commit or stash local changes before setup; no files were changed.'
for operation in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply BISECT_START; do
  [[ ! -e "$(git rev-parse --git-path "$operation")" ]] ||
    die 'Finish the active Git operation before setup.'
done

printf '[personal-os] Fetching the latest origin/main...\n'
# Keep configured SSH wrappers/options while making the supported OpenSSH transport
# noninteractive. GIT_SSH is a filename rather than a shell command, so quote it.
ssh_command="${GIT_SSH_COMMAND:-$(git config --get core.sshCommand || true)}"
if [[ -z "$ssh_command" ]]; then
  printf -v ssh_command '%q' "${GIT_SSH:-ssh}"
fi
# OpenSSH keeps the first repeated option. Refuse caller-supplied overrides
# rather than appending an ineffective safety setting behind one.
shopt -s nocasematch
if [[ "$ssh_command" =~ BatchMode|ConnectTimeout ]]; then
  die 'Remove BatchMode/ConnectTimeout from the configured SSH command; setup supplies these options.'
fi
shopt -u nocasematch
# An explicit refspec also works in clones configured to fetch a single feature branch.
GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=false SSH_ASKPASS=false \
  GIT_SSH_COMMAND="$ssh_command -o BatchMode=yes -o ConnectTimeout=15" \
  git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=60 \
  fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main' ||
  die 'Could not fetch origin/main. Check network access and Git credentials, then rerun setup.'
target="$(git rev-parse refs/remotes/origin/main)"
git merge-base --is-ancestor HEAD "$target" ||
  die 'This checkout has commits outside origin/main. Use a fresh worktree for latest-main setup.'

if git symbolic-ref -q HEAD >/dev/null; then
  git merge --ff-only "$target"
else
  git checkout --detach "$target"
fi
printf '[personal-os] Setup revision: %s\n' "$(git rev-parse HEAD)"
