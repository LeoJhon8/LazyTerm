export const IS_ANDROID = typeof navigator !== "undefined"
  && /\bAndroid\b/i.test(navigator.userAgent);

export const IS_IOS = typeof navigator !== "undefined"
  && /\b(iPad|iPhone|iPod)\b/i.test(navigator.userAgent);

export const IS_DESKTOP = !IS_ANDROID && !IS_IOS;

export const IS_SSH_BACKGROUND_MODE_SUPPORTED = IS_DESKTOP || IS_ANDROID;

export function isAndroidConnectionType(type: string): boolean {
  return type === "ssh";
}
