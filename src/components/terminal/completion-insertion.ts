export function getCompletionInsertion(input: string, text: string) {
  if (text.startsWith(input)) {
    return text.substring(input.length);
  }

  const trimmedInput = input.trim();
  const trimmedText = text.trim();

  if (trimmedText.startsWith(trimmedInput)) {
    return text.substring(trimmedInput.length);
  }

  return "\b".repeat(input.length) + text;
}
