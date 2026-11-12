const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "www");
const files = [
  "index.html",
  "js/00-erros.js",
  "js/01-base.js",
  "js/02-player-nativo.js",
  "js/03-estado-cor-tema.js",
  "js/04-navegacao-dialogos.js",
  "js/05-importar.js",
  "js/06-playlists-listas.js",
  "js/07-reproducao.js",
  "js/08-progresso-player-completo.js",
  "js/09-ajustes.js",
  "js/10-fontes-letras.js",
  "js/pasta-monitorada.js",
  "js/12-onboarding.js",
  "js/13-fila-salva.js",
  "js/14-audio-extras.js",
  "js/15-idioma.js",
  "js/16-widgets.js",
  "js/11-inicio-pwa.js",
  "style.css",
  "jsmediatags.min.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png"
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) {
    if (file.startsWith("icon-")) continue;
    throw new Error("Arquivo obrigatório não encontrado: " + file);
  }
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.copyFileSync(source, path.join(out, file));
}
console.log("Arquivos web preparados em www/");
