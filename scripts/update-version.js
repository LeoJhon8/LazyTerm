import fs from "node:fs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const versionFlagIndex = args.indexOf("--version");
const explicitVersion =
  versionFlagIndex >= 0
    ? args[versionFlagIndex + 1]
    : args.find((arg) => !arg.startsWith("--"));

if (versionFlagIndex >= 0 && !explicitVersion) {
  throw new Error("--version requires a value such as 26.81.2912");
}

function versionFromLastCommit() {
  let date = new Date();

  try {
    const timestamp = execFileSync("git", ["log", "-1", "--format=%ct"], {
      encoding: "utf8",
    }).trim();

    if (timestamp) {
      date = new Date(Number.parseInt(timestamp, 10) * 1000);
    }
  } catch {
    // Source archives without Git metadata fall back to the current UTC time.
  }

  const year = date.getUTCFullYear() - 2000;
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();

  // Windows installers require Major <= 255, Minor <= 255 and Patch <= 65535.
  const major = year;
  const minor = month * 10 + Math.floor(day / 10);
  const patch = (day % 10) * 24 * 60 + hours * 60 + minutes;

  return `${major}.${minor}.${patch}`;
}

function assertValidVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid version "${version}"; expected numeric Major.Minor.Patch`);
  }

  const [, major, minor, patch] = match.map(Number);
  if (major > 255 || minor > 255 || patch > 65535) {
    throw new Error(
      `Version "${version}" exceeds Windows limits (Major <= 255, Minor <= 255, Patch <= 65535)`,
    );
  }
}

const packageJsonPath = "./package.json";
const packageLockPath = "./package-lock.json";
const tauriConfPath = "./src-tauri/tauri.conf.json";
const cargoTomlPath = "./src-tauri/Cargo.toml";
const cargoLockPath = "./src-tauri/Cargo.lock";

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = explicitVersion ?? (checkOnly ? packageJson.version : versionFromLastCommit());
assertValidVersion(version);

const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf8"));
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const cargoLock = fs.readFileSync(cargoLockPath, "utf8");

const cargoTomlVersion = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
const cargoLockVersion =
  /^\[\[package\]\]\r?\nname = "app"\r?\nversion = "([^"]+)"/m.exec(cargoLock)?.[1];

if (!cargoTomlVersion || !cargoLockVersion) {
  throw new Error("Unable to locate the LazyTerm version in Cargo.toml or Cargo.lock");
}

const observedVersions = new Map([
  [packageJsonPath, packageJson.version],
  [packageLockPath, packageLock.version],
  [`${packageLockPath} (root package)`, packageLock.packages?.[""]?.version],
  [tauriConfPath, tauriConf.version],
  [cargoTomlPath, cargoTomlVersion],
  [cargoLockPath, cargoLockVersion],
]);

if (checkOnly) {
  const mismatches = [...observedVersions].filter(([, current]) => current !== version);
  if (mismatches.length > 0) {
    const details = mismatches
      .map(([file, current]) => `- ${file}: ${current ?? "missing"} (expected ${version})`)
      .join("\n");
    throw new Error(`Version check failed:\n${details}`);
  }

  console.log(`Version ${version} is consistent across all manifests and lock files.`);
  process.exit(0);
}

packageJson.version = version;
packageLock.version = version;
packageLock.packages[""].version = version;
tauriConf.version = version;

const updatedCargoToml = cargoToml.replace(
  /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
  `$1${version}$2`,
);
const updatedCargoLock = cargoLock.replace(
  /(^\[\[package\]\]\r?\nname = "app"\r?\nversion = ")[^"]+("\s*$)/m,
  `$1${version}$2`,
);

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
fs.writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);
fs.writeFileSync(cargoTomlPath, updatedCargoToml);
fs.writeFileSync(cargoLockPath, updatedCargoLock);

console.log(`Updated version to ${version}`);
