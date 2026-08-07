/**
 * Formulario de boda (confirmaciones + peticiones de canciones) — backend.
 *
 * Escribe en una hoja de cálculo con dos pestañas:
 *   "Invitados"  → una fila POR PERSONA, para poder contar comensales y alergias.
 *   "Canciones"  → una fila por canción pedida.
 *
 * La búsqueda de Spotify va aquí, en el servidor, con Client Credentials: el
 * token es de la aplicación, no del invitado. Así nadie tiene que iniciar
 * sesión y no aplica el límite de 25 usuarios del modo desarrollo de Spotify.
 *
 * CONFIGURACIÓN: ver abajo. Después, ejecuta comprobarConfiguracion().
 */

// ⚠️ Rellena esto EN EL EDITOR DE APPS SCRIPT, no en el repositorio.
// wedding_apps es público en GitHub; el proyecto de Apps Script es privado.
//
// Si prefieres no tenerlos ni en el editor, deja las tres constantes vacías y
// crea estas propiedades en Configuración del proyecto → Propiedades del script:
//   SPREADSHEET_ID, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
var SPREADSHEET_ID = "";
var SPOTIFY_CLIENT_ID = "";
var SPOTIFY_CLIENT_SECRET = "";

var SHEET_GUESTS = "Invitados";
var SHEET_SONGS = "Canciones";

var HEADERS_GUESTS = [
  "Marca temporal",
  "Grupo",
  "Nombre",
  "Tipo",
  "Edad",
  "Asiste",
  "Menú infantil",
  "Alergias",
  "Otras dietas",
  "Mensaje",
];

var HEADERS_SONGS = [
  "Marca temporal",
  "Quién la pide",
  "Canción",
  "Artista",
  "Álbum",
  "Duración",
  "ID de Spotify",
  "Enlace",
];

// El endpoint es público: sin topes, una sola petición podría llenar la hoja.
var MAX_ACOMPANANTES = 20;
var MAX_NINOS = 20;
var MAX_CANCIONES = 30;
var MAX_TEXTO = 500;

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("Raquel y Jose · 22 agosto 2026")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ------------------------------------------------------------------ *
 * Envío del formulario
 * ------------------------------------------------------------------ */

/**
 * Guarda la confirmación de asistencia: una fila por comensal en "Invitados".
 *
 * Las canciones NO entran aquí: van por enviarCanciones() y su propio botón.
 * Son dos envíos independientes a propósito, para que se pueda pedir música sin
 * confirmar y confirmar sin pedir música.
 *
 * @param {Object} data  {first, last, attending, myAllergies, myOther, note,
 *                        adults: [{name, allergies, other}],
 *                        kids:   [{name, age, menu, allergies, other}]}
 * @return {{success: boolean, personas?: number, error?: string}}
 */
function enviarRespuesta(data) {
  try {
    if (!data || typeof data !== "object") {
      throw userError_("No se ha recibido la respuesta.");
    }

    var quien = quien_(data);
    if (data.attending !== "yes" && data.attending !== "no") {
      throw userError_("Dinos si vienes o no.");
    }

    var invitados = filasInvitados_(data, quien, new Date());
    escribirTodo_([
      { nombre: SHEET_GUESTS, cabeceras: HEADERS_GUESTS, rows: invitados },
    ]);

    return { success: true, personas: invitados.length };
  } catch (error) {
    return errorRespuesta_(error);
  }
}

/**
 * Guarda las canciones pedidas: una fila por canción en "Canciones".
 *
 * Va aparte de la confirmación: quien no venga también puede dejar su canción
 * ("bailamos por ti"), y quien ya haya confirmado puede volver a mandar más
 * sin tener que rellenar la confirmación otra vez.
 *
 * @param {Object} data  {first, last, songs: [{id, name, artist, album, duration, url}]}
 * @return {{success: boolean, canciones?: number, error?: string}}
 */
function enviarCanciones(data) {
  try {
    if (!data || typeof data !== "object") {
      throw userError_("No se ha recibido la lista.");
    }

    var quien = quien_(data);
    var canciones = filasCanciones_(data.songs, quien, new Date());
    if (!canciones.length) {
      throw userError_("Añade alguna canción antes de enviar.");
    }

    escribirTodo_([
      { nombre: SHEET_SONGS, cabeceras: HEADERS_SONGS, rows: canciones },
    ]);

    return { success: true, canciones: canciones.length };
  } catch (error) {
    return errorRespuesta_(error);
  }
}

/** Nombre completo de quien envía. Es lo único obligatorio en los dos envíos. */
function quien_(data) {
  var first = texto_(data.first);
  var last = texto_(data.last);
  if (!first && !last) {
    throw userError_("Escribe tu nombre antes de enviar.");
  }
  return (first + " " + last).trim();
}

/** Una fila por persona: principal, acompañantes y niños. */
function filasInvitados_(data, quien, stamp) {
  var attending = data.attending === "yes";
  var rows = [
    [
      stamp,
      quien,
      quien,
      "Principal",
      "",
      attending ? "Sí" : "No",
      "",
      listaAlergias_(data.myAllergies),
      texto_(data.myOther),
      texto_(data.note),
    ],
  ];

  // Si no viene, sus acompañantes tampoco: no tiene sentido apuntarlos.
  if (!attending) return rows;

  limitar_(data.adults, MAX_ACOMPANANTES).forEach(function (p) {
    var nombre = texto_(p && p.name);
    if (!nombre) return; // fila que el invitado añadió y dejó en blanco
    rows.push([
      stamp,
      quien,
      nombre,
      "Acompañante",
      "",
      "Sí",
      "",
      listaAlergias_(p.allergies),
      texto_(p.other),
      "",
    ]);
  });

  limitar_(data.kids, MAX_NINOS).forEach(function (p) {
    var nombre = texto_(p && p.name);
    if (!nombre) return;
    rows.push([
      stamp,
      quien,
      nombre,
      "Niño",
      texto_(p.age).slice(0, 10),
      "Sí",
      p.menu ? "Sí" : "No",
      listaAlergias_(p.allergies),
      texto_(p.other),
      "",
    ]);
  });

  return rows;
}

/** Una fila por canción pedida. */
function filasCanciones_(songs, quien, stamp) {
  return limitar_(songs, MAX_CANCIONES)
    .filter(function (t) {
      return t && texto_(t.name);
    })
    .map(function (t) {
      return [
        stamp,
        quien,
        texto_(t.name),
        texto_(t.artist),
        texto_(t.album),
        texto_(t.duration),
        texto_(t.id).slice(0, 40),
        texto_(t.url).slice(0, 200),
      ];
    });
}

/* ------------------------------------------------------------------ *
 * Canciones
 * ------------------------------------------------------------------ */

/**
 * Busca canciones en Spotify con el token de la aplicación.
 *
 * @param {string} query  Texto libre: canción, artista…
 * @return {{success: boolean, results?: Array, error?: string}}
 */
function buscarCanciones(query) {
  try {
    var q = texto_(query).slice(0, 100);
    if (!q) {
      throw userError_("Escribe algo primero.");
    }

    var url =
      "https://api.spotify.com/v1/search?" +
      "q=" +
      encodeURIComponent(q) +
      "&type=track&limit=8&market=ES";

    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + spotifyToken_() },
      muteHttpExceptions: true,
    });

    // Token caducado o revocado: lo tiramos y reintentamos una vez.
    if (response.getResponseCode() === 401) {
      CacheService.getScriptCache().remove("spotify_token");
      response = UrlFetchApp.fetch(url, {
        headers: { Authorization: "Bearer " + spotifyToken_() },
        muteHttpExceptions: true,
      });
    }

    if (response.getResponseCode() === 429) {
      throw userError_(
        "Spotify va saturado. Espera unos segundos y reintenta.",
      );
    }

    if (response.getResponseCode() !== 200) {
      console.error(
        "Spotify search " +
          response.getResponseCode() +
          ": " +
          response.getContentText(),
      );
      throw userError_("No se ha podido buscar. Inténtalo otra vez.");
    }

    var items =
      (JSON.parse(response.getContentText()).tracks || {}).items || [];

    return {
      success: true,
      results: items.map(function (t) {
        var images = (t.album && t.album.images) || [];
        return {
          id: t.id,
          name: t.name,
          artist: (t.artists || [])
            .map(function (a) {
              return a.name;
            })
            .join(", "),
          album: (t.album || {}).name || "",
          duration: duracion_(t.duration_ms),
          url: (t.external_urls || {}).spotify || "",
          // La imagen más pequeña: es una miniatura de 50px en la interfaz.
          img: (images[images.length - 1] || {}).url || "",
        };
      }),
    };
  } catch (error) {
    return errorRespuesta_(error);
  }
}

/** Token de aplicación (Client Credentials), cacheado hasta que caduca. */
function spotifyToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("spotify_token");
  if (cached) return cached;

  var id = ajuste_("SPOTIFY_CLIENT_ID");
  var secret = ajuste_("SPOTIFY_CLIENT_SECRET");
  if (!id || !secret) {
    throw userError_("La búsqueda de canciones no está configurada todavía.");
  }

  var response = UrlFetchApp.fetch("https://accounts.spotify.com/api/token", {
    method: "post",
    payload: { grant_type: "client_credentials" },
    headers: {
      Authorization: "Basic " + Utilities.base64Encode(id + ":" + secret),
    },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    // El cuerpo del error puede incluir pistas de las credenciales: solo al log.
    console.error(
      "Spotify token " +
        response.getResponseCode() +
        ": " +
        response.getContentText(),
    );
    throw userError_("No se ha podido conectar con Spotify.");
  }

  var body = JSON.parse(response.getContentText());
  // Un poco menos que expires_in, para no usar un token recién caducado.
  cache.put(
    "spotify_token",
    body.access_token,
    Math.max(60, (body.expires_in || 3600) - 120),
  );
  return body.access_token;
}

/* ------------------------------------------------------------------ *
 * Hoja de cálculo
 * ------------------------------------------------------------------ */

/**
 * Añade filas al final de varias pestañas, creándolas con cabeceras si hace
 * falta, todo bajo un único bloqueo.
 *
 * El bloqueo es imprescindible: varios invitados enviando a la vez leerían el
 * mismo getLastRow() y se pisarían las filas. Y abarca las dos pestañas para
 * que una respuesta no quede a medias.
 *
 * @param {Array<{nombre: string, cabeceras: Array, rows: Array}>} bloques
 */
function escribirTodo_(bloques) {
  var pendientes = bloques.filter(function (b) {
    return b.rows.length;
  });
  if (!pendientes.length) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw userError_(
      "Hay mucha gente enviando a la vez. Inténtalo en unos segundos.",
    );
  }
  try {
    pendientes.forEach(function (b) {
      var sheet = hoja_(b.nombre, b.cabeceras);
      sheet
        .getRange(sheet.getLastRow() + 1, 1, b.rows.length, b.cabeceras.length)
        .setValues(b.rows);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Abre el libro configurado. El fallo tiene mensaje propio a propósito: si el id
 * está mal o la hoja se ha borrado, "no se ha podido guardar" a secas no dice
 * nada y toca ir al registro de ejecuciones para enterarse.
 */
function libro_() {
  var id = idHoja_();
  try {
    return SpreadsheetApp.openById(id);
  } catch (error) {
    console.error(
      "No se puede abrir la hoja configurada (" + id + "): " + error,
    );
    throw userError_(
      "No se puede acceder a la hoja de respuestas. Avisad a los novios.",
    );
  }
}

function hoja_(nombre, cabeceras) {
  var libro = libro_();
  var sheet = libro.getSheetByName(nombre);

  if (!sheet) {
    sheet = libro.insertSheet(nombre);
  }
  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(1, 1, 1, cabeceras.length)
      .setValues([cabeceras])
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function idHoja_() {
  var id = ajuste_("SPREADSHEET_ID");
  if (!id) {
    throw userError_(
      "El formulario todavía no está configurado. Avisad a los novios.",
    );
  }
  return id;
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

/**
 * Lee un ajuste: primero la constante de arriba, y si está vacía, la propiedad
 * del script con ese mismo nombre.
 *
 * La constante se lee con `typeof` (ver `constante_`) y no por el identificador
 * suelto a propósito: si alguien borra la línea `var SPREADSHEET_ID = "";` (por
 * ejemplo para usar solo propiedades de script), o pega el archivo a partir de
 * la mitad, esto devuelve "" y sale el aviso de "falta configurar" en vez de
 * reventar con "SPREADSHEET_ID is not defined" y un mensaje genérico.
 */
function ajuste_(nombre) {
  return (
    constante_(nombre) ||
    (PropertiesService.getScriptProperties().getProperty(nombre) || "").trim()
  );
}

/**
 * Valor de una de las constantes de configuración de arriba.
 *
 * Se leen con `typeof` y no directamente porque `typeof` es lo único que no
 * lanza cuando el identificador ni siquiera existe: así, borrar la línea
 * `var SPREADSHEET_ID = "";` (por ejemplo para usar solo propiedades de script)
 * o pegar el archivo a partir de la mitad da el aviso de "falta configurar" en
 * vez de reventar con "SPREADSHEET_ID is not defined" y un mensaje genérico.
 */
function constante_(nombre) {
  switch (nombre) {
    case "SPREADSHEET_ID":
      return typeof SPREADSHEET_ID === "string" ? SPREADSHEET_ID.trim() : "";
    case "SPOTIFY_CLIENT_ID":
      return typeof SPOTIFY_CLIENT_ID === "string"
        ? SPOTIFY_CLIENT_ID.trim()
        : "";
    case "SPOTIFY_CLIENT_SECRET":
      return typeof SPOTIFY_CLIENT_SECRET === "string"
        ? SPOTIFY_CLIENT_SECRET.trim()
        : "";
  }
  return "";
}

function texto_(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim().slice(0, MAX_TEXTO);
}

function limitar_(lista, maximo) {
  return Array.isArray(lista) ? lista.slice(0, maximo) : [];
}

function listaAlergias_(lista) {
  return limitar_(lista, 30).map(texto_).filter(Boolean).join(", ");
}

function duracion_(ms) {
  if (!ms) return "";
  var total = Math.round(ms / 1000);
  var segundos = total % 60;
  return Math.floor(total / 60) + ":" + (segundos < 10 ? "0" : "") + segundos;
}

function userError_(message) {
  var error = new Error(message);
  error.esDeUsuario = true;
  return error;
}

// Los errores inesperados se registran, pero al invitado le llega un texto
// genérico: los mensajes internos pueden contener ids o credenciales.
function errorRespuesta_(error) {
  if (error && error.esDeUsuario) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return {
    success: false,
    error: "No se ha podido guardar. Inténtalo otra vez.",
  };
}

/* ------------------------------------------------------------------ *
 * Configuración y diagnóstico
 * ------------------------------------------------------------------ */

/**
 * Crea una hoja de cálculo nueva con las dos pestañas y deja su id en el log.
 * Ejecútala una sola vez si aún no tienes hoja.
 */
function crearHojaDeCalculo() {
  var libro = SpreadsheetApp.create("Boda Raquel y Jose — respuestas");

  var invitados = libro.getSheets()[0].setName(SHEET_GUESTS);
  invitados
    .getRange(1, 1, 1, HEADERS_GUESTS.length)
    .setValues([HEADERS_GUESTS])
    .setFontWeight("bold");
  invitados.setFrozenRows(1);

  var canciones = libro.insertSheet(SHEET_SONGS);
  canciones
    .getRange(1, 1, 1, HEADERS_SONGS.length)
    .setValues([HEADERS_SONGS])
    .setFontWeight("bold");
  canciones.setFrozenRows(1);

  console.log("Hoja creada. Pega este id en SPREADSHEET_ID:\n" + libro.getId());
  console.log("Ábrela aquí: " + libro.getUrl());
}

/**
 * Diagnóstico completo. Ejecútalo ante cualquier fallo: autoriza los permisos,
 * comprueba que se puede escribir en las dos pestañas y que Spotify responde.
 */
function comprobarConfiguracion() {
  var id = ajuste_("SPREADSHEET_ID");
  if (!id) {
    throw new Error(
      "FALTA CONFIGURAR: pega el id de la hoja de cálculo en SPREADSHEET_ID, " +
        "al principio de este archivo. Si aún no tienes hoja, ejecuta crearHojaDeCalculo().",
    );
  }

  var libro = SpreadsheetApp.openById(id);
  console.log("Hoja de cálculo: '" + libro.getName() + "' — " + libro.getUrl());

  // Escritura real en ambas pestañas, y limpieza inmediata.
  [
    { nombre: SHEET_GUESTS, cabeceras: HEADERS_GUESTS },
    { nombre: SHEET_SONGS, cabeceras: HEADERS_SONGS },
  ].forEach(function (p) {
    var sheet = hoja_(p.nombre, p.cabeceras);
    var fila = sheet.getLastRow() + 1;
    sheet.getRange(fila, 1).setValue("prueba de configuración");
    sheet.deleteRow(fila);
    console.log("Pestaña '" + p.nombre + "': se puede escribir.");
  });

  if (!ajuste_("SPOTIFY_CLIENT_ID")) {
    console.warn(
      "Spotify sin configurar: el buscador de canciones no funcionará.",
    );
    return;
  }

  var prueba = buscarCanciones("bailando");
  if (!prueba.success) {
    throw new Error(
      "Spotify falla: " + prueba.error + " (mira el registro de ejecuciones)",
    );
  }
  console.log(
    "Spotify responde. Ejemplo: " +
      prueba.results[0].name +
      " — " +
      prueba.results[0].artist,
  );
  console.log("Todo listo.");
}
