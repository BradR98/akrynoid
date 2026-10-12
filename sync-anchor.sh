#!/bin/bash
# sync-anchor.sh
# Formalizes the deployment of RR10021947 (Anchor) engine updates to other repositories.

if [ -z "$1" ]; then
  echo "Usage: ./sync-anchor.sh <path/to/target/repository>"
  echo "Example: ./sync-anchor.sh ../my-other-game"
  exit 1
fi

TARGET_DIR="$1"
TARGET_LIB="$TARGET_DIR/lib"

# Check if target exists
if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Target directory '$TARGET_DIR' does not exist."
  exit 1
fi

echo "Syncing RR10021947 (Anchor) framework to $TARGET_DIR..."

# Ensure target lib directory exists
mkdir -p "$TARGET_LIB"

# List of core engine files to sync
ANCHOR_FILES=(
  "lib/anchor-audio.js"
  "lib/anchor-headless.js"
  "lib/anchor-input.js"
  "lib/anchor-leaderboard.js"
  "lib/anchor-loop.js"
  "lib/anchor-save.js"
  "lib/anchor-ui.js"
)

# Copy each file
for FILE in "${ANCHOR_FILES[@]}"; do
  if [ -f "$FILE" ]; then
    cp "$FILE" "$TARGET_DIR/$FILE"
    echo "  -> Synced $FILE"
  else
    echo "  -> Warning: $FILE not found in source!"
  fi
done

echo "Sync complete!"
