"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const root = path.resolve(__dirname, "..");
const failures = [];
const checked = [];

function fail(message) {
  failures.push(message);
}

function exists(relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) fail(`arquivo ausente: ${relative}`);
  return absolute;
}

function runNodeCheck(relative) {
  const absolute = exists(relative);
  if (!absolute) return;
  try {
    cp.execFileSync(process.execPath, ["--check", absolute], { stdio: "pipe" });
    checked.push(relative);
  } catch (error) {
    const output = String(error.stderr || error.stdout || error.message).trim();
    fail(`sintaxe inválida em ${relative}${output ? `: ${output}` : ""}`);
  }
}

function readJson(relative) {
  const absolute = exists(relative);
  if (!absolute) return null;
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`JSON inválido em ${relative}: ${error.message}`);
    return null;
  }
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
if (packageJson && packageLock) {
  const rootLock = packageLock.packages && packageLock.packages[""];
  if (packageLock.version !== packageJson.version || !rootLock || rootLock.version !== packageJson.version) {
    fail(`package.json e package-lock.json estão com versões diferentes (esperado ${packageJson.version})`);
  }
}

const jsDir = path.join(root, "js");
for (const name of fs.readdirSync(jsDir).filter(name => name.endsWith(".js")).sort()) {
  runNodeCheck(path.join("js", name));
}
for (const relative of ["scripts/copy-web.js", "scripts/patch-android.js"]) runNodeCheck(relative);

const indexPath = exists("index.html");
if (indexPath) {
  const html = fs.readFileSync(indexPath, "utf8");
  const scriptSources = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(match => match[1]);
  const seen = new Set();
  for (const source of scriptSources) {
    const clean = source.split("?")[0];
    if (clean.startsWith("http://") || clean.startsWith("https://")) continue;
    if (seen.has(clean)) fail(`script duplicado no index.html: ${clean}`);
    seen.add(clean);
    exists(clean);
  }
  for (const required of ["js/01-base.js", "js/05-importar.js", "js/07-reproducao.js", "js/10-fontes-letras.js"]) {
    if (!scriptSources.some(source => source.split("?")[0] === required)) {
      fail(`script essencial não está no index.html: ${required}`);
    }
  }
}

for (const relative of [
  "style.css",
  "m3e-biblioteca.css",
  "sw.js",
  "native/android/MusicaPlugin.java",
  "native/android/MusicaPlaybackService.java",
  "native/android/MainActivity.java"
]) exists(relative);

const pluginPath = path.join(root, "native/android/MusicaPlugin.java");
if (fs.existsSync(pluginPath)) {
  const plugin = fs.readFileSync(pluginPath, "utf8");
  if (!plugin.includes("@CapacitorPlugin(name = \"MusicaNative\"")) fail("MusicaPlugin.java sem anotação Capacitor esperada");
  for (const method of ["listMediaAudioLibrary", "readMediaAudioArtwork", "requestAudioLibraryAccess"]) {
    if (!new RegExp(`\\b${method}\\s*\\(`).test(plugin)) fail(`MusicaPlugin.java sem método essencial: ${method}`);
  }
}

const workflowPath = path.join(root, ".github/workflows/android-apk.yml");
if (fs.existsSync(workflowPath)) {
  const workflow = fs.readFileSync(workflowPath, "utf8");
  if (!workflow.includes("npm run test")) fail("workflow Android não executa npm run test");
  if (!workflow.includes("git diff --check")) fail("workflow Android não executa git diff --check");
}

if (failures.length) {
  console.error("Verificação do projeto falhou:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Verificação do projeto concluída: ${checked.length} arquivos JavaScript válidos.`);
}
