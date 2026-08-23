export const IS_ANDROID = typeof navigator !== "undefined"
  && /\bAndroid\b/i.test(navigator.userAgent);

export function isAndroidConnectionType(type: string): boolean {
  return type === "ssh";
}
