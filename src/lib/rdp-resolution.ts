export interface RdpResolutionPreset {
  value: string;
  width: number;
  height: number;
}

export const RDP_RESOLUTION_PRESETS: readonly RdpResolutionPreset[] = [
  { value: "1024x768", width: 1024, height: 768 },
  { value: "1280x720", width: 1280, height: 720 },
  { value: "1280x800", width: 1280, height: 800 },
  { value: "1280x1024", width: 1280, height: 1024 },
  { value: "1366x768", width: 1366, height: 768 },
  { value: "1440x900", width: 1440, height: 900 },
  { value: "1600x900", width: 1600, height: 900 },
  { value: "1680x1050", width: 1680, height: 1050 },
  { value: "1920x1080", width: 1920, height: 1080 },
  { value: "1920x1200", width: 1920, height: 1200 },
  { value: "2560x1440", width: 2560, height: 1440 },
  { value: "3840x2160", width: 3840, height: 2160 },
];

export const DEFAULT_RDP_RESOLUTION_VALUE = "1280x720";

const DEFAULT_RDP_RESOLUTION = RDP_RESOLUTION_PRESETS.find(
  (preset) => preset.value === DEFAULT_RDP_RESOLUTION_VALUE,
)!;

export function getRdpResolutionPreset(value: string): RdpResolutionPreset {
  return RDP_RESOLUTION_PRESETS.find((preset) => preset.value === value)
    ?? DEFAULT_RDP_RESOLUTION;
}

export function getClosestRdpResolutionPreset(
  width?: number,
  height?: number,
): RdpResolutionPreset {
  if (!width || !height) {
    return DEFAULT_RDP_RESOLUTION;
  }

  return RDP_RESOLUTION_PRESETS.reduce((closest, preset) => {
    const closestDistance = Math.hypot(
      (closest.width - width) / width,
      (closest.height - height) / height,
    );
    const presetDistance = Math.hypot(
      (preset.width - width) / width,
      (preset.height - height) / height,
    );
    return presetDistance < closestDistance ? preset : closest;
  }, DEFAULT_RDP_RESOLUTION);
}
