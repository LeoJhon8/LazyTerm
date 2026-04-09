import fs from 'fs';
import path from 'path';

const date = new Date();
const year = date.getFullYear() - 2000;
const month = (date.getMonth() + 1).toString();
const day = date.getDate().toString().padStart(2, '0');
const hours = date.getHours().toString().padStart(2, '0');
const minutes = date.getMinutes().toString().padStart(2, '0');

// 由于 Windows 下版本号有严格限制 (Major<=255, Minor<=255, Patch<=65535)
// เรา可以采用以下紧凑打包方式实现时间戳自增，并完全符合要求：
// Major: 年份减去 2000
// Minor: 月份 * 10 + 日期除以10向下取整
// Patch: (日期个位数 * 1440) + 当天经过的分钟数
const major = year;
const minor = (parseInt(month) * 10) + Math.floor(parseInt(day) / 10);
const patch = ((parseInt(day) % 10) * 24 * 60) + (parseInt(hours) * 60) + parseInt(minutes);

// Format: Major.Minor.Patch (例如 26.40.12527)
const version = `${major}.${minor}.${patch}`;

const tauriConfPath = './src-tauri/tauri.conf.json';
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2));

const packageJsonPath = './package.json';
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

const cargoTomlPath = './src-tauri/Cargo.toml';
if (fs.existsSync(cargoTomlPath)) {
    let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
    cargoToml = cargoToml.replace(/version\s*=\s*"[^"]+"/, `version = "${version}"`);
    fs.writeFileSync(cargoTomlPath, cargoToml);
}

console.log(`Updated version to ${version}`);
