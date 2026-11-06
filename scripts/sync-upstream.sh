#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
upstream_checkout="$project_root/original/figcraft"
mode="${1:---check}"

if [[ "$mode" != "--check" && "$mode" != "--push" ]]; then
  echo "usage: $0 [--check|--push]" >&2
  exit 2
fi

if [[ ! -d "$upstream_checkout/.git" && ! -f "$upstream_checkout/.git" ]]; then
  echo "original/figcraft is not initialised; run git submodule update --init original/figcraft" >&2
  exit 1
fi

if ! git -C "$upstream_checkout" diff --quiet || ! git -C "$upstream_checkout" diff --cached --quiet; then
  echo "original/figcraft has local changes; refusing to synchronise" >&2
  exit 1
fi

git -C "$upstream_checkout" remote set-url origin git@github.com:glowplug-studio/figcraft.git

if git -C "$upstream_checkout" remote get-url upstream >/dev/null 2>&1; then
  git -C "$upstream_checkout" remote set-url upstream git@github.com:storytold/figcraft.git
else
  git -C "$upstream_checkout" remote add upstream git@github.com:storytold/figcraft.git
fi

git -C "$upstream_checkout" fetch origin main
git -C "$upstream_checkout" fetch upstream main

origin_commit="$(git -C "$upstream_checkout" rev-parse origin/main)"
upstream_commit="$(git -C "$upstream_checkout" rev-parse upstream/main)"

if [[ "$mode" == "--check" ]]; then
  git -C "$upstream_checkout" rev-list --left-right --count origin/main...upstream/main
  exit 0
fi

if ! git -C "$upstream_checkout" merge-base --is-ancestor origin/main upstream/main; then
  echo "fork main diverged from upstream main; refusing to merge or rewrite history" >&2
  exit 1
fi

git -C "$upstream_checkout" switch main
git -C "$upstream_checkout" merge --ff-only upstream/main
git -C "$upstream_checkout" push origin main

echo "Figcraft fork synchronised: $origin_commit -> $upstream_commit"
