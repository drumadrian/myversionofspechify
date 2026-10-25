#!/usr/bin/env bash
# MyVersionOfSpeechify - macOS Quick Speech & Clipboard Reader
# Usage:
#   1. From clipboard:
#      pbpaste | ./speechify-clip.sh
#   2. Direct text:
#      ./speechify-clip.sh "Hello world, this is Neural AI speech."
#   3. Pipe code:
#      cat script.js | ./speechify-clip.sh --code
#
# Can be bound to macOS Automator as a "Quick Action" / "Service" with a global keyboard shortcut!

set -e

PORT=5001
VOICE="${VOICE:-Joanna}"
ENGINE="${ENGINE:-neural}"
CODE_MODE=false

if [[ "$1" == "--code" ]]; then
  CODE_MODE=true
  shift
fi

# Get text from argument or stdin (e.g., pbpaste)
TEXT=""
if [ -n "$1" ]; then
  TEXT="$*"
else
  TEXT=$(cat)
fi

if [ -z "$TEXT" ]; then
  echo "⚠️ No text provided! Usage: pbpaste | ./speechify-clip.sh or ./speechify-clip.sh \"your text\""
  exit 1
fi

echo "🎙️  Sending to MyVersionOfSpeechify (Voice: $VOICE, Engine: $ENGINE)..."

# Send clip to server
JSON_PAYLOAD=$(node -e "
  const text = process.argv[1];
  const voiceId = process.argv[2];
  const engine = process.argv[3];
  const codeMode = process.argv[4] === 'true';
  console.log(JSON.stringify({ text, voiceId, engine, codeMode }));
" "$TEXT" "$VOICE" "$ENGINE" "$CODE_MODE")

RESPONSE=$(curl -s -X POST "http://localhost:${PORT}/synthesize" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD")

AUDIO_URL=$(echo "$RESPONSE" | node -e "
  let data = '';
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.success && parsed.audioUrl) {
        console.log(parsed.audioUrl);
      } else {
        console.error('Error:', parsed.message || 'Unknown error');
        process.exit(1);
      }
    } catch (e) {
      console.error('Failed to parse response:', data);
      process.exit(1);
    }
  });
")

if [ -n "$AUDIO_URL" ]; then
  echo "🔊 Audio ready! Playing via macOS afplay: $AUDIO_URL"
  TEMP_AUDIO="/tmp/speechify_$(date +%s).mp3"
  curl -s "$AUDIO_URL" -o "$TEMP_AUDIO"
  afplay "$TEMP_AUDIO"
  rm -f "$TEMP_AUDIO"
else
  echo "❌ Failed to generate speech."
  exit 1
fi
