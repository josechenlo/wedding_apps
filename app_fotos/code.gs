/**
 * Álbum de fotos de la boda — backend de Google Apps Script.
 *
 * Los invitados abren la web app, eligen fotos del carrete y estas se guardan
 * en una carpeta de Google Drive. La web app se ejecuta como el propietario,
 * así que los invitados no necesitan cuenta de Google ni permisos sobre Drive.
 *
 * CONFIGURACIÓN: pega el id de tu carpeta en FOLDER_ID, aquí debajo. Nada más.
 */

// ⚠️ Pega aquí el id de la carpeta de Drive, EN EL EDITOR DE APPS SCRIPT.
//
// Déjalo VACÍO en el repositorio: wedding_apps es público en GitHub y el
// proyecto de Apps Script es privado, así que el id vive bien ahí y mal aquí.
// Si prefieres no tenerlo ni en el editor, déjalo vacío también y guarda el id
// en Configuración del proyecto → Propiedades del script → DRIVE_FOLDER_ID.
var FOLDER_ID = "";

var FOLDER_ID_PROP = "DRIVE_FOLDER_ID";

// Tope de seguridad. El cliente comprime a ~1 MB; esto solo frena originales
// enormes o a alguien que intente llenar el Drive desde fuera de la web app.
var MAX_BYTES = 15 * 1024 * 1024;

// Extensión real según el tipo de imagen, para no llamar .jpg a un HEIC.
var EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Servir la página HTML al usuario.
// ALLOWALL permite embeber el álbum en una web de boda; si solo repartís el
// enlace directo, DEFAULT es más restrictivo.
function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("Álbum da nosa voda 📸")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Recibe una imagen desde el frontend y la guarda en Drive.
 *
 * @param {string} base64Data  DataURL (data:image/jpeg;base64,...).
 * @param {string} fileName    Nombre original del archivo en el móvil.
 * @param {string} guestName   Nombre del invitado (opcional).
 * @param {string} dateTaken   Fecha de captura "AAAA-MM-DD_HHMM" (opcional).
 * @return {{success: boolean, url?: string, name?: string, error?: string}}
 */
function uploadFile(base64Data, fileName, guestName, dateTaken) {
  try {
    if (!base64Data || typeof base64Data !== "string") {
      throw userError_("Non se recibiu ningunha imaxe.");
    }

    var separator = base64Data.indexOf(",");
    if (separator === -1) {
      throw userError_("O formato da imaxe non é válido.");
    }

    var header = base64Data.slice(0, separator).match(/^data:([^;]+);base64$/);
    if (!header) {
      throw userError_("O formato da imaxe non é válido.");
    }

    // El tipo llega del cliente: hay que validarlo antes de escribir en Drive.
    var contentType = header[1].toLowerCase();
    if (contentType.indexOf("image/") !== 0) {
      throw userError_("Só se admiten imaxes.");
    }

    var payload = base64Data.slice(separator + 1);
    // base64 ocupa 4 caracteres por cada 3 bytes: estimamos sin decodificar.
    if (Math.floor((payload.length * 3) / 4) > MAX_BYTES) {
      throw userError_("A foto pesa de máis (máximo 15 MB).");
    }

    var bytes = Utilities.base64Decode(payload);
    var name = buildFileName_(fileName, guestName, dateTaken, contentType);
    var blob = Utilities.newBlob(bytes, contentType, name);
    var file = getFolder_().createFile(blob);

    return { success: true, url: file.getUrl(), name: file.getName() };
  } catch (error) {
    // Los errores internos pueden contener el id de la carpeta: no se devuelven.
    console.error(error);
    return {
      success: false,
      error:
        error && error.esDeUsuario
          ? error.message
          : "Non se puido gardar a foto. Inténtao outra vez.",
    };
  }
}

/**
 * Construye un nombre ordenable y atribuible:
 *   2026-08-07_2134_Marta_IMG_1234.jpg
 * Ordenar la carpeta por nombre devuelve el orden cronológico real, que es lo
 * que se pierde al recomprimir en el cliente (el canvas borra el EXIF).
 */
function buildFileName_(fileName, guestName, dateTaken, contentType) {
  var base = sanitize_(String(fileName || "").replace(/\.[^/.]+$/, ""));
  var stamp = sanitize_(String(dateTaken || ""));
  var who = sanitize_(String(guestName || "")).slice(0, 30);

  var parts = [];
  if (stamp) parts.push(stamp);
  if (who) parts.push(who);
  parts.push(base.slice(0, 40) || "foto");

  return parts.join("_") + "." + (EXT_BY_TYPE[contentType] || "jpg");
}

// Deja solo caracteres seguros para un nombre de archivo, acentos incluidos.
function sanitize_(text) {
  return text
    .replace(/[^A-Za-z0-9áéíóúüñÁÉÍÓÚÜÑ .\-_]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Devuelve la carpeta destino.
 *
 * Los fallos de configuración se marcan como userError_ a propósito: no
 * revelan el id de la carpeta, pero sí distinguen "falta configurar" de "no se
 * ha podido guardar", que es la diferencia entre saber qué arreglar y no.
 */
function getFolder_() {
  var id = folderId_();
  if (!id) {
    throw userError_("O álbum aínda non está configurado. Avisade aos noivos.");
  }
  try {
    return DriveApp.getFolderById(id);
  } catch (error) {
    // Id incorrecto, carpeta en la papelera, o el propietario perdió el acceso.
    console.error("No se puede abrir la carpeta configurada: " + error);
    throw userError_("Non se pode acceder ao álbum. Avisade aos noivos.");
  }
}

// Marca un error como apto para mostrárselo al invitado tal cual.
function userError_(message) {
  var error = new Error(message);
  error.esDeUsuario = true;
  return error;
}

/**
 * Id de la carpeta destino: la constante de arriba, o la propiedad del script
 * si prefieres no tenerlo en el código. Con rellenar FOLDER_ID basta; no hay
 * que ejecutar nada.
 */
function folderId_() {
  return (
    FOLDER_ID ||
    PropertiesService.getScriptProperties().getProperty(FOLDER_ID_PROP) ||
    ""
  );
}

/**
 * Diagnóstico completo. Ejecútalo desde el editor ante cualquier fallo: además
 * de comprobar la configuración, dispara la ventana de autorización si el
 * script ha ganado permisos nuevos, que es la causa típica de que las subidas
 * fallen justo después de tocar el código.
 */
function comprobarConfiguracion() {
  var id = folderId_();
  if (!id) {
    throw new Error(
      "FALTA CONFIGURAR: pega el id de la carpeta de Drive en la constante " +
        "FOLDER_ID, al principio de este archivo, y guarda con Ctrl+S.",
    );
  }

  var folder = DriveApp.getFolderById(id);
  console.log("Carpeta: '" + folder.getName() + "' — " + folder.getUrl());

  // Escritura real: es lo único que descarta cuota llena o permisos.
  var test = folder.createFile(
    Utilities.newBlob("prueba", "text/plain", "_prueba_configuracion.txt"),
  );
  test.setTrashed(true);

  console.log("Álbum listo: se puede escribir en la carpeta.");
}
