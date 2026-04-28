#!/bin/bash
# Setup Engram aliases for easy access from any repo

SHELL_RC="$HOME/.zshrc"

# Detect shell
if [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

echo "Setting up Engram aliases in $SHELL_RC..."

# Add aliases if not already present
if ! grep -q "ENGRAM=" "$SHELL_RC"; then
  cat >> "$SHELL_RC" << 'EOF'

# Engram - AI assistant's Shared Memory
export ENGRAM="${ENGRAM_PATH:-$HOME/code/Engram}"
alias engram='node $ENGRAM/scripts/engram-loader.js'
alias save-session='node $ENGRAM/scripts/save-session.js'
EOF
  echo "✅ Aliases added to $SHELL_RC"
else
  echo "ℹ️  Aliases already present in $SHELL_RC"
fi

# Source the file
source "$SHELL_RC" 2>/dev/null || true

echo ""
echo "✅ Setup complete!"
echo ""
echo "Now you can use from any directory:"
echo "  engram startup"
echo "  engram quick 'commit format'"
echo "  save-session 'Your summary' --topics tag1,tag2"
echo ""
echo "Restart your terminal or run: source $SHELL_RC"
