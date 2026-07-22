import type { SessionProtocol } from "@/types/terminal";

export function normalizePasteTextForConnector(text: string, protocol: SessionProtocol): string {
  if (protocol !== "ssh") {
    return text;
  }

  return text.replace(/\r\n?/g, "\n");
}
