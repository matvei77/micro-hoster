#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
skill_source="$repo_root/skills/share-on-pages"

(
  cd "$repo_root"
  npm install
  npm link
)

for target in \
  "$HOME/.codex/skills/share-on-pages" \
  "$HOME/.claude/skills/share-on-pages" \
  "$HOME/.kimi-code/skills/share-on-pages"
do
  parent=$(dirname "$target")
  mkdir -p "$parent"

  if [ -L "$target" ]; then
    current=$(readlink "$target")
    if [ "$current" = "$skill_source" ]; then
      continue
    fi
    case "$current" in
      "$repo_root/integrations/skills/share-on-pages"|\
      "$repo_root/.agents/plugins/plugins/micro-hoster/skills/share-on-pages"|\
      "$repo_root/plugins/micro-hoster/skills/share-on-pages")
        rm "$target"
        ;;
      *)
        echo "Skill target already exists and was not changed: $target" >&2
        exit 1
        ;;
    esac
  elif [ -e "$target" ]; then
    echo "Skill target already exists and was not changed: $target" >&2
    exit 1
  fi

  ln -s "$skill_source" "$target"
done

micro-hoster --version
echo "Installed the command and share-on-pages skill for Codex, Claude Code, Kimi Code, and OpenCode."
