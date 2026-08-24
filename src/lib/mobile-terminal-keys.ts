export const MOBILE_TERMINAL_BUILTIN_KEY_IDS = [
  "escape",
  "tab",
  "ctrl-c",
  "arrow-up",
  "arrow-down",
  "arrow-left",
  "arrow-right",
] as const;

export type MobileTerminalBuiltinKeyId = (typeof MOBILE_TERMINAL_BUILTIN_KEY_IDS)[number];
export type MobileTerminalKeyModifier = "ctrl" | "alt" | "shift";
export type MobileTerminalPrimaryKey =
  | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m"
  | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
  | "escape"
  | "tab"
  | "enter"
  | "space"
  | "backspace"
  | "delete"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "home"
  | "end";
export type MobileTerminalKeyToken = MobileTerminalKeyModifier | MobileTerminalPrimaryKey;

export type MobileTerminalKeyItem =
  | { kind: "builtin"; keyId: MobileTerminalBuiltinKeyId }
  | { kind: "custom"; id: string; keys: MobileTerminalKeyToken[] };

export interface MobileTerminalKeyDefinition {
  id: string;
  label: string;
  data: string;
  repeatable: boolean;
  width: "normal" | "wide";
}

export type MobileTerminalKeyParseError =
  | "empty"
  | "too-many"
  | "unsupported-key"
  | "duplicate-key"
  | "missing-primary"
  | "multiple-primary";

export type MobileTerminalKeyParseResult =
  | { ok: true; keys: MobileTerminalKeyToken[]; definition: MobileTerminalKeyDefinition }
  | { ok: false; error: MobileTerminalKeyParseError; token?: string };

export const DEFAULT_MOBILE_TERMINAL_KEYS: MobileTerminalKeyItem[] = [
  { kind: "builtin", keyId: "escape" },
  { kind: "builtin", keyId: "tab" },
  { kind: "builtin", keyId: "ctrl-c" },
  { kind: "builtin", keyId: "arrow-up" },
  { kind: "builtin", keyId: "arrow-down" },
  { kind: "builtin", keyId: "arrow-left" },
  { kind: "builtin", keyId: "arrow-right" },
];

const BUILTIN_DEFINITIONS: Record<MobileTerminalBuiltinKeyId, Omit<MobileTerminalKeyDefinition, "id">> = {
  escape: { label: "Esc", data: "\u001b", repeatable: false, width: "normal" },
  tab: { label: "Tab", data: "\t", repeatable: false, width: "normal" },
  "ctrl-c": { label: "Ctrl+C", data: "\u0003", repeatable: false, width: "wide" },
  "arrow-up": { label: "↑", data: "\u001b[A", repeatable: true, width: "normal" },
  "arrow-down": { label: "↓", data: "\u001b[B", repeatable: true, width: "normal" },
  "arrow-left": { label: "←", data: "\u001b[D", repeatable: true, width: "normal" },
  "arrow-right": { label: "→", data: "\u001b[C", repeatable: true, width: "normal" },
};

const modifierOrder: MobileTerminalKeyModifier[] = ["ctrl", "alt", "shift"];
const modifierSet = new Set<string>(modifierOrder);
const primaryKeys = [
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  "escape",
  "tab",
  "enter",
  "space",
  "backspace",
  "delete",
  "arrow-up",
  "arrow-down",
  "arrow-left",
  "arrow-right",
  "home",
  "end",
] as MobileTerminalPrimaryKey[];
const primaryKeySet = new Set<string>(primaryKeys);
const builtinKeySet = new Set<string>(MOBILE_TERMINAL_BUILTIN_KEY_IDS);

const tokenAliases: Record<string, MobileTerminalKeyToken> = {
  control: "ctrl",
  option: "alt",
  esc: "escape",
  return: "enter",
  del: "delete",
  bs: "backspace",
  up: "arrow-up",
  down: "arrow-down",
  left: "arrow-left",
  right: "arrow-right",
  "↑": "arrow-up",
  "↓": "arrow-down",
  "←": "arrow-left",
  "→": "arrow-right",
};

const tokenLabels: Record<MobileTerminalKeyToken, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  a: "A", b: "B", c: "C", d: "D", e: "E", f: "F", g: "G", h: "H", i: "I",
  j: "J", k: "K", l: "L", m: "M", n: "N", o: "O", p: "P", q: "Q", r: "R",
  s: "S", t: "T", u: "U", v: "V", w: "W", x: "X", y: "Y", z: "Z",
  escape: "Esc",
  tab: "Tab",
  enter: "Enter",
  space: "Space",
  backspace: "Backspace",
  delete: "Del",
  "arrow-up": "↑",
  "arrow-down": "↓",
  "arrow-left": "←",
  "arrow-right": "→",
  home: "Home",
  end: "End",
};

function normalizeToken(value: string): MobileTerminalKeyToken | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return null;
  if (modifierSet.has(normalized) || primaryKeySet.has(normalized)) {
    return normalized as MobileTerminalKeyToken;
  }
  return tokenAliases[normalized] ?? null;
}

function normalizeCombination(value: unknown): MobileTerminalKeyToken[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return null;
  const tokens: MobileTerminalKeyToken[] = [];

  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const token = normalizeToken(candidate);
    if (!token || tokens.includes(token)) return null;
    tokens.push(token);
  }

  const modifiers = modifierOrder.filter((modifier) => tokens.includes(modifier));
  const primaries = tokens.filter((token) => !modifierSet.has(token));
  if (primaries.length !== 1 || modifiers.length + primaries.length > 3) return null;
  return [...modifiers, primaries[0]];
}

function getModifierCode(keys: MobileTerminalKeyToken[]) {
  return 1
    + (keys.includes("shift") ? 1 : 0)
    + (keys.includes("alt") ? 2 : 0)
    + (keys.includes("ctrl") ? 4 : 0);
}

function encodePrimaryKey(
  primary: MobileTerminalPrimaryKey,
  keys: MobileTerminalKeyToken[],
): string {
  const hasCtrl = keys.includes("ctrl");
  const hasAlt = keys.includes("alt");
  const hasShift = keys.includes("shift");
  const modifierCode = getModifierCode(keys);
  let data: string;

  if (/^[a-z]$/.test(primary)) {
    data = hasCtrl
      ? String.fromCharCode(primary.toUpperCase().charCodeAt(0) - 64)
      : hasShift ? primary.toUpperCase() : primary;
    return hasAlt ? `\u001b${data}` : data;
  }

  const arrowSuffix = ({
    "arrow-up": "A",
    "arrow-down": "B",
    "arrow-right": "C",
    "arrow-left": "D",
  } as Partial<Record<MobileTerminalPrimaryKey, string>>)[primary];
  if (arrowSuffix) {
    return modifierCode === 1
      ? `\u001b[${arrowSuffix}`
      : `\u001b[1;${modifierCode}${arrowSuffix}`;
  }

  if (primary === "home" || primary === "end") {
    const suffix = primary === "home" ? "H" : "F";
    return modifierCode === 1
      ? `\u001b[${suffix}`
      : `\u001b[1;${modifierCode}${suffix}`;
  }

  if (primary === "delete") {
    return modifierCode === 1 ? "\u001b[3~" : `\u001b[3;${modifierCode}~`;
  }

  if (primary === "tab") {
    if (modifierCode === 1) return "\t";
    if (modifierCode === 2) return "\u001b[Z";
    return `\u001b[1;${modifierCode}I`;
  }

  data = ({
    escape: "\u001b",
    enter: "\r",
    space: " ",
    backspace: "\u007f",
  } as Partial<Record<MobileTerminalPrimaryKey, string>>)[primary] ?? "";
  return hasAlt ? `\u001b${data}` : data;
}

function createDefinitionFromKeys(
  keys: MobileTerminalKeyToken[],
  id = "custom-preview",
): MobileTerminalKeyDefinition {
  const primary = keys.find((token) => !modifierSet.has(token)) as MobileTerminalPrimaryKey;
  const label = keys.map((token) => tokenLabels[token]).join("+");
  const isSingleArrow = keys.length === 1 && primary.startsWith("arrow-");
  return {
    id,
    label,
    data: encodePrimaryKey(primary, keys),
    repeatable: isSingleArrow,
    width: label.length > 5 ? "wide" : "normal",
  };
}

export function parseMobileTerminalKeyCombination(input: string): MobileTerminalKeyParseResult {
  const rawTokens = input.split("+").map((token) => token.trim()).filter(Boolean);
  if (rawTokens.length === 0) return { ok: false, error: "empty" };
  if (rawTokens.length > 3) return { ok: false, error: "too-many" };

  const tokens: MobileTerminalKeyToken[] = [];
  for (const rawToken of rawTokens) {
    const token = normalizeToken(rawToken);
    if (!token) return { ok: false, error: "unsupported-key", token: rawToken };
    if (tokens.includes(token)) return { ok: false, error: "duplicate-key", token: rawToken };
    tokens.push(token);
  }

  const primaryCount = tokens.filter((token) => !modifierSet.has(token)).length;
  if (primaryCount === 0) return { ok: false, error: "missing-primary" };
  if (primaryCount > 1) return { ok: false, error: "multiple-primary" };

  const keys = normalizeCombination(tokens);
  if (!keys) return { ok: false, error: "too-many" };
  return { ok: true, keys, definition: createDefinitionFromKeys(keys) };
}

export function createCustomMobileTerminalKey(
  keys: MobileTerminalKeyToken[],
): MobileTerminalKeyItem {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { kind: "custom", id: `custom-${suffix}`, keys: [...keys] };
}

export function getMobileTerminalKeyItemId(item: MobileTerminalKeyItem) {
  return item.kind === "builtin" ? `builtin:${item.keyId}` : item.id;
}

export function resolveMobileTerminalKeyDefinition(
  item: MobileTerminalKeyItem,
): MobileTerminalKeyDefinition {
  if (item.kind === "builtin") {
    return {
      id: getMobileTerminalKeyItemId(item),
      ...BUILTIN_DEFINITIONS[item.keyId],
    };
  }
  return createDefinitionFromKeys(item.keys, item.id);
}

export function normalizeMobileTerminalKeys(value: unknown): MobileTerminalKeyItem[] {
  if (!Array.isArray(value)) {
    return DEFAULT_MOBILE_TERMINAL_KEYS.map((item) => ({ ...item }));
  }

  const normalized: MobileTerminalKeyItem[] = [];
  const seenIds = new Set<string>();

  value.forEach((candidate) => {
    let item: MobileTerminalKeyItem | null = null;

    if (typeof candidate === "string" && builtinKeySet.has(candidate)) {
      item = { kind: "builtin", keyId: candidate as MobileTerminalBuiltinKeyId };
    } else if (candidate && typeof candidate === "object") {
      const data = candidate as Record<string, unknown>;
      if (data.kind === "builtin" && typeof data.keyId === "string" && builtinKeySet.has(data.keyId)) {
        item = { kind: "builtin", keyId: data.keyId as MobileTerminalBuiltinKeyId };
      } else if (data.kind === "custom" && typeof data.id === "string") {
        const keys = normalizeCombination(data.keys);
        if (keys) item = { kind: "custom", id: data.id, keys };
      }
    }

    if (!item) return;
    const id = getMobileTerminalKeyItemId(item);
    if (seenIds.has(id)) return;
    seenIds.add(id);
    normalized.push(item);
  });

  return normalized;
}
