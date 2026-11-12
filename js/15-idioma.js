"use strict";

/* ==========================================================
   Idioma: português, inglês e espanhol.
   O app é escrito em português; os textos são traduzidos na tela
   por um dicionário (texto exato) e por algumas regras (plural/números).
   Texto que não estiver no dicionário continua em português.
   ========================================================== */
const LANGS = [
  { id: "pt", initials: "PT", name: "Português", hue: 145 },
  { id: "en", initials: "EN", name: "English", hue: 215 },
  { id: "es", initials: "ES", name: "Español", hue: 25 }
];

// português → [inglês, espanhol]
const LANG_DICT = {
  /* tela inicial, navegação e player */
  "Início": ["Home", "Inicio"], "Biblioteca": ["Library", "Biblioteca"], "Buscar": ["Search", "Buscar"],
  "Ajustes": ["Settings", "Ajustes"], "Músicas": ["Songs", "Canciones"], "Álbuns": ["Albums", "Álbumes"],
  "Artistas": ["Artists", "Artistas"], "Gêneros": ["Genres", "Géneros"], "Playlists": ["Playlists", "Listas"],
  "Favoritas": ["Favorites", "Favoritas"], "Recentes": ["Recent", "Recientes"], "Mais ouvidas": ["Most played", "Más escuchadas"],
  "Para você": ["For you", "Para ti"], "Continuar ouvindo": ["Keep listening", "Seguir escuchando"],
  "Tocadas recentemente": ["Recently played", "Reproducidas recientemente"], "Seus favoritos": ["Your favorites", "Tus favoritas"],
  "Sua coleção musical": ["Your music collection", "Tu colección musical"], "Suas músicas": ["Your songs", "Tus canciones"],
  "SUA MÚSICA, SEU UNIVERSO": ["YOUR MUSIC, YOUR UNIVERSE", "TU MÚSICA, TU UNIVERSO"],
  "DESCUBRA SUAS MÚSICAS": ["DISCOVER YOUR MUSIC", "DESCUBRE TU MÚSICA"],
  "Adicionar músicas": ["Add songs", "Añadir canciones"], "Adicione músicas na Biblioteca": ["Add songs in the Library", "Añade canciones en la Biblioteca"],
  "Adicione músicas para começar": ["Add songs to get started", "Añade canciones para empezar"],
  "Nenhuma música": ["No songs", "Ninguna canción"], "Nenhuma música adicionada": ["No songs added", "Ninguna canción añadida"],
  "Nenhuma favorita": ["No favorites", "Ninguna favorita"], "Sua biblioteca está vazia": ["Your library is empty", "Tu biblioteca está vacía"],
  "Pesquisar músicas...": ["Search songs...", "Buscar canciones..."], "Pesquisar músicas na coleção": ["Search songs in your collection", "Buscar canciones en tu colección"],
  "Pesquise na sua coleção.": ["Search your collection.", "Busca en tu colección."],
  "Nenhum resultado encontrado": ["No results found", "No se encontraron resultados"],
  "Tocando agora": ["Now playing", "Reproduciendo"], "Letra": ["Lyrics", "Letra"],
  "Abrir letras da música atual": ["Open lyrics for the current song", "Abrir la letra de la canción actual"],
  "Abrir player completo": ["Open full player", "Abrir reproductor completo"], "Adicionar aos favoritos": ["Add to favorites", "Añadir a favoritas"],
  "Remover dos favoritos": ["Remove from favorites", "Quitar de favoritas"], "Alternar tema": ["Toggle theme", "Cambiar tema"],
  "Fechar": ["Close", "Cerrar"], "Mais opções": ["More options", "Más opciones"], "Mostrar letra": ["Show lyrics", "Mostrar letra"],
  "Ocultar letra": ["Hide lyrics", "Ocultar letra"], "Anterior": ["Previous", "Anterior"], "Próxima": ["Next", "Siguiente"],
  "Próxima música": ["Next song", "Siguiente canción"], "Progresso": ["Progress", "Progreso"], "Progresso da música": ["Song progress", "Progreso de la canción"],
  "Tocar música": ["Play song", "Reproducir canción"], "Tocar ou pausar": ["Play or pause", "Reproducir o pausar"], "Tocar": ["Play", "Reproducir"],
  "Aleatório desligado": ["Shuffle off", "Aleatorio desactivado"], "Aleatório ligado": ["Shuffle on", "Aleatorio activado"],
  "Repetir desligado": ["Repeat off", "Repetir desactivado"], "Repetir lista": ["Repeat list", "Repetir lista"],
  "Repetir esta música": ["Repeat this song", "Repetir esta canción"], "Repetindo a lista": ["Repeating the list", "Repitiendo la lista"],
  "Repetindo esta música": ["Repeating this song", "Repitiendo esta canción"], "Voltar": ["Back", "Atrás"],
  "Arquivo local": ["Local file", "Archivo local"], "Artista desconhecido": ["Unknown artist", "Artista desconocido"],
  "Sem título": ["Untitled", "Sin título"], "Sem álbum": ["No album", "Sin álbum"], "Sem gênero": ["No genre", "Sin género"],
  "Bom dia": ["Good morning", "Buenos días"], "Boa tarde": ["Good afternoon", "Buenas tardes"],
  "Boa noite": ["Good evening", "Buenas noches"], "Boa madrugada": ["Good early morning", "Buenas madrugadas"],
  "Todas": ["All", "Todas"], "Preparando a música": ["Preparing the song", "Preparando la canción"], "Preparando a música…": ["Preparing the song…", "Preparando la canción…"],
  "Escolha uma música primeiro": ["Pick a song first", "Elige una canción primero"],

  /* menus e ações */
  "Opções": ["Options", "Opciones"], "Cancelar": ["Cancel", "Cancelar"], "Salvar": ["Save", "Guardar"], "Criar": ["Create", "Crear"],
  "Apagar": ["Delete", "Borrar"], "Excluir": ["Delete", "Eliminar"], "Adicionar": ["Add", "Añadir"], "Concluir": ["Done", "Listo"],
  "Continuar": ["Continue", "Continuar"], "Pular": ["Skip", "Omitir"], "Pular tudo": ["Skip all", "Omitir todo"], "Escolher": ["Choose", "Elegir"],
  "Zerar": ["Reset", "Restablecer"], "Restaurar": ["Restore", "Restaurar"], "Copiar tudo": ["Copy all", "Copiar todo"], "Vamos lá": ["Let's go", "Vamos"],
  "Adicionar à playlist": ["Add to playlist", "Añadir a una lista"], "Remover desta playlist": ["Remove from this playlist", "Quitar de esta lista"],
  "Excluir música": ["Delete song", "Eliminar canción"], "Excluir música?": ["Delete song?", "¿Eliminar canción?"], "Música excluída": ["Song deleted", "Canción eliminada"],
  "Nova playlist": ["New playlist", "Nueva lista"], "Nome da playlist": ["Playlist name", "Nombre de la lista"],
  "Renomear playlist": ["Rename playlist", "Renombrar lista"], "Excluir playlist": ["Delete playlist", "Eliminar lista"],
  "Excluir playlist?": ["Delete playlist?", "¿Eliminar lista?"], "Playlist excluída": ["Playlist deleted", "Lista eliminada"],
  "Playlist vazia": ["Empty playlist", "Lista vacía"], "A playlist está vazia": ["The playlist is empty", "La lista está vacía"],
  "Playlist": ["Playlist", "Lista"], "Importar músicas": ["Import songs", "Importar canciones"], "Escolher arquivos": ["Choose files", "Elegir archivos"],
  "Escolher mais arquivos": ["Choose more files", "Elegir más archivos"], "Escolher pasta": ["Choose folder", "Elegir carpeta"],
  "Adicionar outra pasta": ["Add another folder", "Añadir otra carpeta"], "Importando músicas… ": ["Importing songs… ", "Importando canciones… "],
  "Lendo a pasta…": ["Reading the folder…", "Leyendo la carpeta…"], "Arquivos adicionados": ["Files added", "Archivos añadidos"],
  "Essas músicas já estão na biblioteca": ["These songs are already in the library", "Estas canciones ya están en la biblioteca"],
  "Nenhum áudio selecionado": ["No audio selected", "Ningún audio seleccionado"], "Arquivos de áudio": ["Audio files", "Archivos de audio"],
  "Nenhuma música encontrada nessa pasta": ["No songs found in this folder", "No se encontraron canciones en esta carpeta"],
  "Não consegui ler esse arquivo": ["I couldn't read this file", "No pude leer este archivo"],

  /* letras e capas */
  "Ajustar letra": ["Adjust lyrics", "Ajustar letra"], "Adiantar a letra em meio segundo": ["Advance the lyrics by half a second", "Adelantar la letra medio segundo"],
  "Atrasar a letra em meio segundo": ["Delay the lyrics by half a second", "Retrasar la letra medio segundo"],
  "Buscar letra sincronizada": ["Find synced lyrics", "Buscar letra sincronizada"], "Buscando letras online…": ["Looking for lyrics online…", "Buscando letras en línea…"],
  "Abrir e buscar a letra": ["Open and look up the lyrics", "Abrir y buscar la letra"], "Letra adicionada": ["Lyrics added", "Letra añadida"],
  "Letra removida": ["Lyrics removed", "Letra eliminada"], "Remover letra": ["Remove lyrics", "Quitar letra"],
  "Letra encontrada pelo LRCLIB": ["Lyrics found on LRCLIB", "Letra encontrada en LRCLIB"], "Letras sincronizadas": ["Synced lyrics", "Letras sincronizadas"],
  "Mostrar letra disponível": ["Show available lyrics", "Mostrar letra disponible"], "Capa atualizada": ["Cover updated", "Carátula actualizada"],
  "Capa da música": ["Song cover", "Carátula de la canción"], "Trocar capa pela galeria": ["Change cover from gallery", "Cambiar carátula desde la galería"],
  "Escolher capa da galeria": ["Pick cover from gallery", "Elegir carátula de la galería"], "Escolher da galeria": ["Pick from gallery", "Elegir de la galería"],
  "Buscar na internet": ["Search the internet", "Buscar en internet"],

  /* ajustes */
  "Perfil": ["Profile", "Perfil"], "Aparência": ["Appearance", "Apariencia"], "Reprodução": ["Playback", "Reproducción"],
  "Comportamento": ["Behavior", "Comportamiento"], "Privacidade": ["Privacy", "Privacidad"], "Diagnóstico": ["Diagnostics", "Diagnóstico"],
  "Idioma": ["Language", "Idioma"], "Usa o idioma do seu celular": ["Uses your phone's language", "Usa el idioma de tu teléfono"], "Automático": ["Automatic", "Automático"], "Seu nome": ["Your name", "Tu nombre"],
  "Seu nome e saudação": ["Your name and greeting", "Tu nombre y saludo"], "Como você quer ser chamado?": ["What should we call you?", "¿Cómo quieres que te llamemos?"],
  "Importar músicas e pastas": ["Import songs and folders", "Importar canciones y carpetas"],
  "Cor do app, fonte, preto total, capa em disco": ["App color, font, true black, disc cover", "Color de la app, fuente, negro total, carátula en disco"],
  "Player nativo e segundo plano": ["Native player and background", "Reproductor nativo y segundo plano"],
  "Deslizar entre páginas e gestos": ["Page swiping and gestures", "Deslizar entre páginas y gestos"],
  "Buscas online de letras e capas": ["Online lyrics and cover lookups", "Búsquedas en línea de letras y carátulas"],
  "Registro de erros": ["Error log", "Registro de errores"], "Nenhum problema registrado": ["No problems logged", "Ningún problema registrado"],
  "Há problemas registrados; toque para ver e copiar": ["Problems were logged; tap to view and copy", "Hay problemas registrados; toca para ver y copiar"],
  "Player nativo (segundo plano mais estável)": ["Native player (more stable in background)", "Reproductor nativo (segundo plano más estable)"],
  "Toca pelo Android, mesmo com o app congelado. Feche e abra o app depois de mudar.": ["Plays through Android, even when the app is frozen. Close and reopen the app after changing.", "Suena a través de Android, incluso con la app congelada. Cierra y abre la app después de cambiarlo."],
  "Deslizar entre páginas": ["Swipe between pages", "Deslizar entre páginas"], "Inverter o gesto": ["Reverse the gesture", "Invertir el gesto"],
  "Arraste para o lado para trocar de página": ["Drag sideways to change pages", "Arrastra hacia el lado para cambiar de página"],
  "Troca a direção do arrastar entre as páginas": ["Swaps the swipe direction between pages", "Cambia la dirección del deslizamiento entre páginas"],
  "Busca online": ["Online lookup", "Búsqueda en línea"], "Buscar letras automaticamente": ["Find lyrics automatically", "Buscar letras automáticamente"],
  "Buscar capas automaticamente": ["Find covers automatically", "Buscar carátulas automáticamente"],
  "Consulta o LRCLIB usando título, artista e duração; o áudio não é enviado": ["Queries LRCLIB using title, artist and duration; the audio is not sent", "Consulta LRCLIB con título, artista y duración; el audio no se envía"],
  "Consulta a iTunes usando título e artista ao importar; o áudio não é enviado": ["Queries iTunes using title and artist when importing; the audio is not sent", "Consulta iTunes con título y artista al importar; el audio no se envía"],
  "Lista de Diretórios": ["Folder list", "Lista de carpetas"], "Diretórios ignorados": ["Ignored folders", "Carpetas ignoradas"],
  "Pastas de música que o Nyx verifica automaticamente.": ["Music folders that Nyx checks automatically.", "Carpetas de música que Nyx revisa automáticamente."],
  "Pastas dentro dos diretórios monitorados que não devem ser varridas.": ["Folders inside the watched folders that should not be scanned.", "Carpetas dentro de las carpetas vigiladas que no deben analizarse."],
  "Atualizar agora": ["Update now", "Actualizar ahora"], "Procura músicas novas nos diretórios adicionados": ["Looks for new songs in the added folders", "Busca canciones nuevas en las carpetas añadidas"],
  "Importação e controles": ["Import and controls", "Importación y controles"], "Escolha arquivos e veja o suporte do navegador": ["Choose files and check browser support", "Elige archivos y revisa la compatibilidad del navegador"],
  "Nenhum diretório adicionado": ["No folders added", "Ninguna carpeta añadida"], "Nenhum diretório ignorado": ["No folders ignored", "Ninguna carpeta ignorada"],
  "Esse diretório já está na lista": ["This folder is already on the list", "Esta carpeta ya está en la lista"],
  "Diretórios já estão atualizados": ["Folders are already up to date", "Las carpetas ya están actualizadas"],
  "A seleção de diretórios só funciona no app Android": ["Folder selection only works in the Android app", "La selección de carpetas solo funciona en la app de Android"],
  "Verificado automaticamente em busca de músicas novas": ["Checked automatically for new songs", "Revisado automáticamente en busca de canciones nuevas"],
  "Ler gêneros das músicas": ["Read song genres", "Leer géneros de las canciones"],
  "Procura o gênero nas etiquetas das músicas que já estão na biblioteca": ["Looks for the genre in the tags of songs already in the library", "Busca el género en las etiquetas de las canciones que ya están en la biblioteca"],
  "Nenhum gênero novo encontrado nas etiquetas": ["No new genres found in the tags", "No se encontraron géneros nuevos en las etiquetas"],
  "Não consegui ler os gêneros.": ["I couldn't read the genres.", "No pude leer los géneros."],

  /* aparência */
  "Cor do app": ["App color", "Color de la app"], "Preto total": ["True black", "Negro total"],
  "Fundo preto puro (economiza bateria em tela AMOLED)": ["Pure black background (saves battery on AMOLED screens)", "Fondo negro puro (ahorra batería en pantallas AMOLED)"],
  "Capa em disco": ["Disc cover", "Carátula en disco"], "A capa vira um disco que gira enquanto toca": ["The cover becomes a spinning disc while playing", "La carátula se convierte en un disco que gira al reproducir"],
  "Fonte das letras": ["Lyrics font", "Fuente de la letra"], "Importar fonte": ["Import font", "Importar fuente"], "Apagar fonte": ["Delete font", "Borrar fuente"],
  "Apagar essa fonte?": ["Delete this font?", "¿Borrar esta fuente?"], "Fonte do sistema": ["System font", "Fuente del sistema"],
  "Padrão do app": ["App default", "Predeterminado de la app"], "Padrão": ["Default", "Predeterminado"], "Minha fonte": ["My font", "Mi fuente"],
  "Importada por você": ["Imported by you", "Importada por ti"], "Papel de parede": ["Wallpaper", "Fondo de pantalla"],
  "Remover papel de parede": ["Remove wallpaper", "Quitar fondo de pantalla"], "Desfoque": ["Blur", "Desenfoque"], "Intensidade": ["Intensity", "Intensidad"],
  "Capa em disco ": ["Disc cover ", "Carátula en disco "], "Azul": ["Blue", "Azul"], "Verde": ["Green", "Verde"], "Vermelho": ["Red", "Rojo"],
  "Laranja": ["Orange", "Naranja"], "Rosa": ["Pink", "Rosa"], "Roxo": ["Purple", "Morado"], "Turquesa": ["Turquoise", "Turquesa"],
  "Da capa da música": ["From the song cover", "De la carátula de la canción"], "Formas das bolinhas": ["Dot shapes", "Formas de los puntos"],
  "Restaurar formas": ["Restore shapes", "Restaurar formas"], "Círculo": ["Circle", "Círculo"], "Quadrado": ["Square", "Cuadrado"],
  "Pílula": ["Pill", "Píldora"], "Estrela": ["Star", "Estrella"], "Flor": ["Flower", "Flor"], "Coração": ["Heart", "Corazón"],
  "Losango": ["Diamond", "Rombo"], "Hexágono": ["Hexagon", "Hexágono"], "Disco": ["Disc", "Disco"], "Biscoito": ["Cookie", "Galleta"],

  /* temporizador, equalizador, transição */
  "Temporizador de desligar": ["Sleep timer", "Temporizador de apagado"], "Dormir": ["Sleep", "Dormir"],
  "Ao fim desta música": ["At the end of this song", "Al final de esta canción"], "Cancelar temporizador": ["Cancel timer", "Cancelar temporizador"],
  "Temporizador cancelado": ["Timer canceled", "Temporizador cancelado"], "Desligado": ["Off", "Apagado"], "Ligado": ["On", "Activado"],
  "Pausa ao fim desta música": ["Pauses at the end of this song", "Pausa al final de esta canción"],
  "A música vai pausar quando esta terminar": ["The music will pause when this song ends", "La música se pausará cuando termine esta canción"],
  "Temporizador: música pausada.": ["Timer: music paused.", "Temporizador: música pausada."],
  "Não consegui ajustar o temporizador.": ["I couldn't set the timer.", "No pude ajustar el temporizador."],
  "Começa quando a música tocar (pausa ao fim dela)": ["Starts when the music plays (pauses at the end of the song)", "Empieza cuando suene la música (pausa al final de la canción)"],
  "Equalizador": ["Equalizer", "Ecualizador"], "Som": ["Sound", "Sonido"], "Predefinições": ["Presets", "Preajustes"],
  "Ajusta graves, médios e agudos de tudo que toca no Nyx": ["Adjusts bass, mids and treble for everything played in Nyx", "Ajusta graves, medios y agudos de todo lo que suena en Nyx"],
  "Faixas de frequência": ["Frequency bands", "Bandas de frecuencia"], "Reforço de graves": ["Bass boost", "Refuerzo de graves"],
  "Graves extras": ["Extra bass", "Graves extra"], "Volta todas as faixas para zero": ["Resets all bands to zero", "Pone todas las bandas a cero"],
  "Normal": ["Normal", "Normal"], "Graves": ["Bass", "Graves"], "Agudos": ["Treble", "Agudos"], "Vocal": ["Vocal", "Vocal"],
  "Eletrônica": ["Electronic", "Electrónica"], "Hip-hop": ["Hip-hop", "Hip-hop"], "Clássica": ["Classical", "Clásica"],
  "Este aparelho não oferece equalizador para o player do Nyx.": ["This device doesn't offer an equalizer for the Nyx player.", "Este dispositivo no ofrece ecualizador para el reproductor de Nyx."],
  "Carregando…": ["Loading…", "Cargando…"], "Transição suave": ["Smooth transition", "Transición suave"], "Desligada": ["Off", "Desactivada"],
  "Transição suave desligada": ["Smooth transition off", "Transición suave desactivada"],
  "Não consegui ajustar a transição.": ["I couldn't set the transition.", "No pude ajustar la transición."],
  "A transição suave abaixa o volume no fim de cada música e sobe no começo da próxima. As músicas da fila tocam emendadas, sem pausa entre elas, quando o formato do arquivo permite.": ["Smooth transition lowers the volume at the end of each song and raises it at the start of the next. Songs in the queue play back to back, without a gap, when the file format allows.", "La transición suave baja el volumen al final de cada canción y lo sube al inicio de la siguiente. Las canciones de la cola suenan seguidas, sin pausa, cuando el formato del archivo lo permite."],

  /* notificações, permissões e diagnóstico */
  "Notificações": ["Notifications", "Notificaciones"], "Ativar notificações": ["Enable notifications", "Activar notificaciones"],
  "Notificações ativadas": ["Notifications enabled", "Notificaciones activadas"], "Permissão não concedida": ["Permission not granted", "Permiso no concedido"],
  "Desativar otimização": ["Disable optimization", "Desactivar optimización"], "Otimização já estava desativada": ["Optimization was already disabled", "La optimización ya estaba desactivada"],
  "Confirme na janela do Android": ["Confirm in the Android window", "Confirma en la ventana de Android"], "Pedido enviado": ["Request sent", "Solicitud enviada"],
  "Bem-vindo ao Nyx": ["Welcome to Nyx", "Bienvenido a Nyx"], "Configuração inicial do Nyx": ["Nyx initial setup", "Configuración inicial de Nyx"]
};

// regras para textos com números e plurais
const LANG_GREET = {
  "BOA MADRUGADA": ["GOOD EARLY MORNING", "BUENAS MADRUGADAS"], "BOM DIA": ["GOOD MORNING", "BUENOS DÍAS"],
  "BOA TARDE": ["GOOD AFTERNOON", "BUENAS TARDES"], "BOA NOITE": ["GOOD EVENING", "BUENAS NOCHES"]
};
const LANG_RULES = [
  [/^(BOA MADRUGADA|BOM DIA|BOA TARDE|BOA NOITE)(, [\s\S]*)?$/, (g, r) => LANG_GREET[g][0] + (r || ""), (g, r) => LANG_GREET[g][1] + (r || "")],
  [/^(\d+) músicas?$/, (n) => n + (n === "1" ? " song" : " songs"), (n) => n + (n === "1" ? " canción" : " canciones")],
  [/^(\d+) músicas? adicionadas?$/, (n) => n + (n === "1" ? " song added" : " songs added"), (n) => n + (n === "1" ? " canción añadida" : " canciones añadidas")],
  [/^(\d+) músicas? na biblioteca$/, (n) => n + (n === "1" ? " song in the library" : " songs in the library"), (n) => n + (n === "1" ? " canción en la biblioteca" : " canciones en la biblioteca")],
  [/^(\d+) músicas? encontradas?$/, (n) => n + (n === "1" ? " song found" : " songs found"), (n) => n + (n === "1" ? " canción encontrada" : " canciones encontradas")],
  [/^(\d+) músicas? novas?…$/, (n) => n + (n === "1" ? " new song…" : " new songs…"), (n) => n + (n === "1" ? " canción nueva…" : " canciones nuevas…")],
  [/^(\d+) músicas? ganh(?:ou|aram) gênero$/, (n) => n + (n === "1" ? " song got a genre" : " songs got a genre"), (n) => n + (n === "1" ? " canción obtuvo género" : " canciones obtuvieron género")],
  [/^(\d+) reproduç(?:ão|ões)$/, (n) => n + (n === "1" ? " play" : " plays"), (n) => n + (n === "1" ? " reproducción" : " reproducciones")],
  [/^(\d+) resultados? para (.*)$/, (n, q) => n + (n === "1" ? " result for " : " results for ") + q, (n, q) => n + (n === "1" ? " resultado para " : " resultados para ") + q],
  [/^Nenhum resultado para (.*)$/, (q) => "No results for " + q, (q) => "Ningún resultado para " + q],
  [/^A música vai pausar em (\d+) minutos$/, (n) => "The music will pause in " + n + " minutes", (n) => "La música se pausará en " + n + " minutos"],
  [/^Temporizador de desligar · (.*)$/, (r) => "Sleep timer · " + r, (r) => "Temporizador de apagado · " + r],
  [/^Pausa em (\d+) minutos?$/, (n) => "Pauses in " + n + (n === "1" ? " minute" : " minutes"), (n) => "Pausa en " + n + (n === "1" ? " minuto" : " minutos")],
  [/^Começa quando a música tocar \((\d+) min\)$/, (n) => "Starts when the music plays (" + n + " min)", (n) => "Empieza cuando suene la música (" + n + " min)"],
  [/^(\d+) minutos$/, (n) => n + " minutes", (n) => n + " minutos"],
  [/^(\d+) segundos$/, (n) => n + " seconds", (n) => n + " segundos"],
  [/^Transição suave: (\d+) segundos$/, (n) => "Smooth transition: " + n + " seconds", (n) => "Transición suave: " + n + " segundos"],
  [/^Remover (.+)$/, (x) => "Remove " + x, (x) => "Quitar " + x],
  [/^Tocar (.+)$/, (x) => "Play " + x, (x) => "Reproducir " + x],
  [/^Abrir player completo: (.+)$/, (x) => "Open full player: " + x, (x) => "Abrir reproductor completo: " + x],
  [/^Cor atual: (.+)$/, (x) => "Current color: " + x, (x) => "Color actual: " + x]
];

let currentLang = "pt";
const langOriginal = new WeakMap(); // nó/atributo → texto em português
const langShown = new WeakMap();    // nó → último texto que o app (ou a tradução) deixou lá
let langObserver = null;
let langBusy = false;

function detectDeviceLang() {
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "pt"]);
  for (const l of list) {
    const c = String(l).toLowerCase().slice(0, 2);
    if (c === "pt" || c === "en" || c === "es") return c;
  }
  return "pt";
}

function resolveLang() {
  const s = settings.language;
  return s === "pt" || s === "en" || s === "es" ? s : detectDeviceLang();
}

function translateString(str, lang) {
  if (lang === "pt" || !str) return str;
  const m = str.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2];
  if (!core) return str;
  const idx = lang === "en" ? 0 : 1;
  let out = null;
  if (Object.prototype.hasOwnProperty.call(LANG_DICT, core)) out = LANG_DICT[core][idx];
  else {
    for (const rule of LANG_RULES) {
      const r = core.match(rule[0]);
      if (r) { out = rule[idx + 1](...r.slice(1)); break; }
    }
  }
  return out === null ? str : m[1] + out + m[3];
}

const LANG_SKIP = "script, style, textarea, input, .material-symbols-rounded, [data-notr], #fpLyrics, #fpTitle, #fpArtist, .lyric-line";
const LANG_ATTRS = ["aria-label", "placeholder", "title"];

function langSkipped(node) {
  const e = node.nodeType === 1 ? node : node.parentElement;
  return !e || !!e.closest(LANG_SKIP);
}

function translateTextNode(node) {
  if (langSkipped(node)) return;
  let orig = langOriginal.get(node);
  // se o app trocou o texto, o novo texto é o original em português
  if (orig === undefined || node.data !== langShown.get(node)) orig = node.data;
  langOriginal.set(node, orig);
  const next = translateString(orig, currentLang);
  langShown.set(node, next);
  if (node.data !== next) node.data = next;
}

function translateAttrs(e) {
  if (e.closest("script, style, [data-notr]")) return;
  for (const a of LANG_ATTRS) {
    if (!e.hasAttribute(a)) continue;
    let store = langOriginal.get(e);
    if (!store) { store = {}; langOriginal.set(e, store); }
    const cur = e.getAttribute(a);
    const rec = store[a];
    const orig = rec && rec.shown === cur ? rec.orig : cur;
    const next = translateString(orig, currentLang);
    store[a] = { orig, shown: next };
    if (cur !== next) e.setAttribute(a, next);
  }
}

function translateTree(root) {
  if (!root) return;
  if (root.nodeType === 3) { translateTextNode(root); return; }
  if (root.nodeType !== 1) return;
  translateAttrs(root);
  root.querySelectorAll("[aria-label], [placeholder], [title]").forEach(translateAttrs);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) translateTextNode(n);
}

function startLangObserver() {
  if (langObserver || typeof MutationObserver === "undefined") return;
  langObserver = new MutationObserver(muts => {
    if (langBusy) return;
    langBusy = true;
    try {
      for (const m of muts) {
        if (m.type === "characterData") translateTextNode(m.target);
        else if (m.type === "attributes") translateAttrs(m.target);
        else m.addedNodes.forEach(translateTree);
      }
    } catch (e) { logErr("idioma:observar", e); }
    // descarta as mudanças que a própria tradução acabou de fazer
    langObserver.takeRecords();
    langBusy = false;
  });
  langObserver.observe(document.body, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: LANG_ATTRS
  });
}

function applyLanguage() {
  currentLang = resolveLang();
  document.documentElement.lang = currentLang === "pt" ? "pt-BR" : currentLang;
  langBusy = true;
  try { translateTree(document.body); } catch (e) { logErr("idioma:aplicar", e); }
  langBusy = false;
  startLangObserver();
}

function languageSummary() {
  const s = settings.language;
  const l = LANGS.find(x => x.id === s);
  if (l) return l.name;
  const d = LANGS.find(x => x.id === detectDeviceLang());
  return "Automático (" + (d ? d.name : "Português") + ")";
}

function langCircle(hue, initials) {
  const c = el("span", "lang-circle", initials);
  c.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;flex:none;font-weight:700;font-size:14px;letter-spacing:.5px;color:#fff;background:hsl(" + hue + " 55% 42%)";
  c.setAttribute("data-notr", "");
  return c;
}

function pageIdioma() {
  const sec = el("div", "set-sec");
  sec.appendChild(el("div", "set-label", "Idioma"));

  const choose = id => {
    settings.language = id;
    saveSettings();
    applyLanguage();
    refreshSettingsPage();
  };

  const rows = [{ id: "auto", initials: "A", name: "Automático", hue: 265, desc: "Usa o idioma do seu celular" }]
    .concat(LANGS.map(l => ({ id: l.id, initials: l.initials, name: l.name, hue: l.hue, desc: "" })));

  rows.forEach(r => {
    const selected = (settings.language || "auto") === r.id;
    const row = el("button", "set-row");
    const text = el("div", "set-row-text");
    const title = el("strong", "", r.name);
    if (r.id !== "auto") title.setAttribute("data-notr", "");
    text.appendChild(title);
    if (r.desc) text.appendChild(el("span", "", r.desc));
    row.append(langCircle(r.hue, r.initials), text, el("span", "material-symbols-rounded", selected ? "check_circle" : "radio_button_unchecked"));
    row.style.gap = "14px";
    row.onclick = () => choose(r.id);
    sec.appendChild(row);
  });
  return [sec];
}

SETTINGS_PAGES.idioma = { title: "Idioma", build: pageIdioma };

applyLanguage();
