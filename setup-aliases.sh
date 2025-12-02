#!/bin/bash
# Setup Memex aliases for easy access from any repo

SHELL_RC="$HOME/.zshrc"

# Detect shell
if [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

echo "Setting up Memex aliases in $SHELL_RC..."

# Add aliases if not already present
if ! grep -q "MEMEX=" "$SHELL_RC"; then
  cat >> "$SHELL_RC" << 'EOF'

# Memex - Claude's Shared Memory
export MEMEX="$HOME/code/cirrus/DevOps/Memex"
alias memex='node $MEMEX/scripts/memex-loader.js'
alias save-session='node $MEMEX/scripts/save-session.js'
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
echo "  memex startup"
echo "  memex quick 'commit format'"
echo "  save-session 'Your summary' --topics tag1,tag2"
echo ""
echo "Restart your terminal or run: source $SHELL_RC"
