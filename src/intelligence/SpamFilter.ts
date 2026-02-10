export function isSpam(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;

  const normalized = raw.toLowerCase();

  // Single emoji or emoji-only short text
  const emojiOnly = raw.replace(
    /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu,
    '',
  ).trim();
  if (emojiOnly.length === 0) return true;

  // Common spam phrases
  if (normalized.includes('promote on')) return true;
  if (normalized.includes('send pic')) return true;

  // Repetitive text (same token repeated)
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    const unique = new Set(tokens);
    if (unique.size === 1) return true;
  }

  // Repetitive characters
  if (/([a-z0-9])\1{5,}/i.test(normalized)) return true;

  return false;
}
