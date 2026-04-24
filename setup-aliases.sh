#!/bin/bash
# Setup Codicil aliases for easy access from any repo

SHELL_RC="$HOME/.zshrc"

# Detect shell
if [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
fi

echo "Setting up Codicil aliases in $SHELL_RC..."

# Add aliases if not already present
if ! grep -q "CODICIL=" "$SHELL_RC"; then
  cat >> "$SHELL_RC" << 'EOF'

# Codicil - AI assistant's Shared Memory
export CODICIL="${CODICIL_PATH:-$HOME/code/Codicil}"
alias codicil='node $CODICIL/scripts/codicil-loader.js'
alias save-session='node $CODICIL/scripts/save-session.js'
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
echo "  codicil startup"
echo "  codicil quick 'commit format'"
echo "  save-session 'Your summary' --topics tag1,tag2"
echo ""
echo "Restart your terminal or run: source $SHELL_RC"
