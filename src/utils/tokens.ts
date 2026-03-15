// Approximate token counting: ~4 characters per token (GPT-style heuristic).
// Good enough for compression ratio reporting without a tokenizer dependency.

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(messages: { content: string }[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}
