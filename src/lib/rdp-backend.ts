import type { RdpBackend } from "@/types/terminal";

export type ConfigurableRdpBackend = Extract<RdpBackend, "freerdp" | "msrdpax">;

export function isWindowsPlatform(): boolean {
  return typeof window !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");
}

export function resolveRdpBackend(preferred?: RdpBackend): ConfigurableRdpBackend {
  if (!isWindowsPlatform()) {
    return "freerdp";
  }

  return preferred === "msrdpax" ? "msrdpax" : "freerdp";
}
