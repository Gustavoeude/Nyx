// Depois de "npx cap add android": copia o serviço de áudio nativo para o projeto
// Android e declara permissões e serviço no AndroidManifest.xml.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appId = JSON.parse(fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8")).appId;
const javaDir = path.join(root, "android/app/src/main/java", ...appId.split("."));
const manifestPath = path.join(root, "android/app/src/main/AndroidManifest.xml");

if (!fs.existsSync(manifestPath)) throw new Error("Projeto Android não encontrado. Rode 'npx cap add android' antes.");

fs.mkdirSync(javaDir, { recursive: true });
const srcDir = path.join(root, "native/android");
for (const f of fs.readdirSync(srcDir).filter(n => n.endsWith(".java"))) {
  const code = fs.readFileSync(path.join(srcDir, f), "utf8");
  if (!code.includes("package " + appId + ";")) throw new Error(f + ": pacote diferente de " + appId);
  fs.writeFileSync(path.join(javaDir, f), code);
  console.log("copiado", f);
}

/* Registra o plugin local antes da inicialização da Bridge do Capacitor. */
const activityPath = path.join(javaDir, "MainActivity.java");
if (!fs.existsSync(activityPath)) {
  throw new Error("MainActivity.java não encontrada em " + activityPath);
}
let activity = fs.readFileSync(activityPath, "utf8");
if (!activity.includes("registerPlugin(MusicaPlugin.class)")) {
  const onCreate = /(public\s+void\s+onCreate\s*\(\s*Bundle\s+\w+\s*\)\s*\{)/;
  if (!onCreate.test(activity)) {
    throw new Error("Não foi possível localizar onCreate(Bundle) em MainActivity.java");
  }
  activity = activity.replace(onCreate, "$1\n        registerPlugin(MusicaPlugin.class);");
  fs.writeFileSync(activityPath, activity);
  console.log("plugin MusicaPlugin registrado na MainActivity");
} else {
  console.log("plugin MusicaPlugin já estava registrado");
}

let xml = fs.readFileSync(manifestPath, "utf8");
const missingPermissions = [
  "android.permission.INTERNET",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.WAKE_LOCK",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
].filter(permission => !xml.includes('"' + permission + '"'));

if (missingPermissions.length) {
  const declarations = missingPermissions
    .map(permission => '    <uses-permission android:name="' + permission + '" />')
    .join("\n") + "\n";
  if (!xml.includes("<application")) throw new Error("AndroidManifest sem tag <application>");
  xml = xml.replace("<application", declarations + "    <application");
}

const services = [];
if (!xml.includes('android:name=".MusicaService"')) {
  services.push('        <service android:name=".MusicaService" android:exported="false" android:foregroundServiceType="mediaPlayback" />');
}
if (!xml.includes('android:name=".MusicaPlaybackService"')) {
  services.push(
    '        <service android:name=".MusicaPlaybackService" android:exported="true" android:foregroundServiceType="mediaPlayback">',
    '            <intent-filter>',
    '                <action android:name="androidx.media3.session.MediaSessionService" />',
    '            </intent-filter>',
    '        </service>'
  );
}
if (services.length) {
  if (!xml.includes("</application>")) throw new Error("AndroidManifest sem </application>");
  xml = xml.replace("</application>", services.join("\n") + "\n    </application>");
}

if (missingPermissions.length || services.length) {
  fs.writeFileSync(manifestPath, xml);
  console.log("AndroidManifest atualizado (permissões e serviços verificados)");
}
/* ----- widgets da tela inicial: receivers no manifesto ----- */
const widgetReceivers = [
  ["NyxWidgetA", "Nyx · Compacto (4×1)", "nyx_widget_a"],
  ["NyxWidgetB", "Nyx · Médio (4×2)", "nyx_widget_b"],
  ["NyxWidgetC", "Nyx · Quadrado (2×2)", "nyx_widget_c"]
].filter(([cls]) => !xml.includes('android:name=".' + cls + '"'));
if (widgetReceivers.length) {
  const decl = widgetReceivers.map(([cls, label, info]) =>
    '        <receiver android:name=".' + cls + '" android:exported="false" android:label="' + label + '">\n' +
    '            <intent-filter>\n' +
    '                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />\n' +
    '            </intent-filter>\n' +
    '            <meta-data android:name="android.appwidget.provider" android:resource="@xml/' + info + '" />\n' +
    '        </receiver>'
  ).join("\n");
  xml = xml.replace("</application>", decl + "\n    </application>");
  fs.writeFileSync(manifestPath, xml);
  console.log("widgets registrados no AndroidManifest");
}

/* ----- nome, ícone e versão do app ----- */
const res = path.join(root, "android/app/src/main/res");
const APP_NAME = "Nyx";

// nome
const stringsPath = path.join(res, "values/strings.xml");
if (fs.existsSync(stringsPath)) {
  let st = fs.readFileSync(stringsPath, "utf8");
  st = st.replace(/(<string name="app_name">)[^<]*(<\/string>)/, "$1" + APP_NAME + "$2");
  st = st.replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, "$1" + APP_NAME + "$2");
  fs.writeFileSync(stringsPath, st);
  console.log("nome do app:", APP_NAME);
}

// ícone (adaptativo + antigo)
const resSrc = path.join(root, "native/res");
const bg = fs.readFileSync(path.join(resSrc, "bg.txt"), "utf8").trim();
for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  const from = path.join(resSrc, "mipmap-" + d);
  const to = path.join(res, "mipmap-" + d);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
  // restos do ícone padrão do Capacitor em outros formatos
  for (const f of ["ic_launcher_foreground.png", "ic_launcher_foreground.webp", "ic_launcher.webp", "ic_launcher_round.webp"]) {
    fs.rmSync(path.join(to, f), { force: true });
  }
}
fs.mkdirSync(path.join(res, "values"), { recursive: true });
fs.writeFileSync(
  path.join(res, "values/musica_colors.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="musica_icon_bg">' + bg + "</color>\n</resources>\n"
);
const adaptive =
  '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <background android:drawable="@color/musica_icon_bg"/>\n    <foreground android:drawable="@mipmap/musica_fg"/>\n</adaptive-icon>\n';
fs.mkdirSync(path.join(res, "mipmap-anydpi-v26"), { recursive: true });
fs.writeFileSync(path.join(res, "mipmap-anydpi-v26/ic_launcher.xml"), adaptive);
fs.writeFileSync(path.join(res, "mipmap-anydpi-v26/ic_launcher_round.xml"), adaptive);
// layouts, ícones e configuração dos widgets da tela inicial
for (const d of ["layout", "drawable", "xml"]) {
  const from = path.join(resSrc, d);
  if (!fs.existsSync(from)) continue;
  const to = path.join(res, d);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(to, f));
}
// ícone monocromático e transparente usado nas notificações de mídia
// (também as prévias dos widgets que aparecem no seletor de widgets)
const notificationDrawableDir = path.join(res, "drawable-nodpi");
fs.mkdirSync(notificationDrawableDir, { recursive: true });
for (const f of fs.readdirSync(path.join(resSrc, "drawable-nodpi"))) {
  fs.copyFileSync(path.join(resSrc, "drawable-nodpi", f), path.join(notificationDrawableDir, f));
}
// ícone do botão "fechar" (X) do card de música
fs.mkdirSync(path.join(res, "drawable"), { recursive: true });
fs.writeFileSync(
  path.join(res, "drawable/ic_fechar.xml"),
  '<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n' +
  '    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">\n' +
  '    <path android:fillColor="#FFFFFFFF" android:pathData="M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z"/>\n</vector>\n'
);
console.log("ícone aplicado");

// versionCode: sobe a cada build (necessário para atualizar por cima do app instalado)
const gradlePath = path.join(root, "android/app/build.gradle");
let g = fs.readFileSync(gradlePath, "utf8");
// Media3 (ExoPlayer + sessão de mídia) para o player nativo
const media3Dependencies = [
  '    implementation "androidx.media3:media3-exoplayer:1.11.1"',
  '    implementation "androidx.media3:media3-session:1.11.1"'
];
const missingMedia3 = media3Dependencies.filter(dependency => {
  const coordinate = dependency.split('"')[1].split(':').slice(0, 2).join(':');
  return !g.includes(coordinate);
});
if (missingMedia3.length) {
  if (!g.includes("dependencies {")) throw new Error("Bloco dependencies não encontrado no build.gradle");
  g = g.replace("dependencies {", "dependencies {\n" + missingMedia3.join("\n"));
  console.log("Dependências Media3 verificadas/adicionadas");
}
const code = parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseTag = process.env.GITHUB_REF_TYPE === "tag" && /^v\d+\.\d+\.\d+$/.test(process.env.GITHUB_REF_NAME || "");
const versionName = releaseTag ? pkg.version : (pkg.version || "1.0.0") + "." + code;
g = g.replace(/versionCode\s+\d+/, "versionCode " + code).replace(/versionName\s+"[^"]*"/, 'versionName "' + versionName + '"');
fs.writeFileSync(gradlePath, g);
console.log("versionCode:", code);
console.log("versionName:", versionName);
