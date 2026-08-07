# CLAUDE.md

## Objetivo del proyecto

Este repositorio es una colección de **utilidades pequeñas y rápidas para organizar una boda**,
construidas principalmente como **Google Apps Script** (web apps servidas desde Google, con
Drive / Sheets / Forms como backend).

La idea es que cada utilidad sea:

- **Autocontenida**: una carpeta por app, sin dependencias entre ellas.
- **Rápida de desplegar**: pegar los archivos en un proyecto de Apps Script y publicar como web app.
- **Sin infraestructura propia**: nada de servidores, bases de datos ni build steps. Todo se apoya
  en la cuenta de Google de los novios.
- **Usable desde el móvil por invitados no técnicos**: un enlace o un QR, y listo.

## Apps

### `app_fotos/` — Subida de fotos por los invitados

Primera utilidad del repo. Permite que los invitados suban fotos **directamente durante la boda**
a través de un formulario web, sin instalar nada y sin necesidad de tener cuenta de Google.

Flujo:

1. El invitado abre la web app (enlace / QR repartido en la boda) y opcionalmente escribe su nombre.
2. Selecciona **una o varias** fotos del carrete, que entran en una cola con estado individual.
3. Para cada foto, justo antes de subirla: se lee la **fecha de captura del EXIF** y el navegador la
   **redimensiona y comprime a JPEG en el cliente** (canvas, máx. 1920px, calidad 0.85) para no
   saturar la cuota de Apps Script ni la conexión del banquete.
4. Se envía como DataURL base64 vía `google.script.run` a `uploadFile`, **de una en una** (Apps Script
   limita las ejecuciones simultáneas y en una boda hay muchos móviles a la vez).
5. Apps Script valida el tipo y el tamaño, y guarda el archivo en la carpeta de Drive configurada.

Archivos:

- [app_fotos/code.gs](app_fotos/code.gs) — backend: `doGet()` sirve el HTML y
  `uploadFile(base64Data, fileName, guestName, dateTaken)` valida y guarda el blob en Drive.
- [app_fotos/index.html](app_fotos/index.html) — frontend autocontenido: CSS inline, cola de subida,
  compresión en cliente y lector de EXIF. **Comparte el diseño de `app_formulario`**: misma paleta
  vino (`--wine: #8c1d24`) sobre crema, las mismas tres tipografías incrustadas y la misma portada
  (guirnalda de luces, bola de espejos y los novios en Sacramento).

Puntos a tener en cuenta al tocar esta app:

- **Esta app está en gallego** (`<html lang="gl">`), a diferencia de `app_formulario`. Eso incluye los
  mensajes de error que `uploadFile` devuelve al invitado vía `userError_()`. Lo que **no** se traduce
  son los comentarios ni el diagnóstico de `comprobarConfiguracion()`, que solo lee quien la despliega.
- El **ID de la carpeta de Drive se pega en la constante `FOLDER_ID`**, al principio de `code.gs`,
  **desde el editor de Apps Script**. En el repositorio esa constante va siempre **vacía**: este repo
  es público en GitHub y el proyecto de Apps Script es privado. Alternativa para no tenerlo ni en el
  editor: la propiedad de script `DRIVE_FOLDER_ID`, que `folderId_()` usa como respaldo.
  `comprobarConfiguracion()` verifica ambas vías haciendo una escritura real en la carpeta.
- `doGet()` carga el archivo `'Index'` (con mayúscula): dentro del proyecto de Apps Script el archivo
  HTML debe llamarse `Index`, aunque en el repo esté como `index.html`.
- Los nombres se construyen como `AAAA-MM-DD_HHMM_Invitado_Original.jpg`. **El prefijo de fecha es
  deliberado**: recomprimir en canvas borra el EXIF, así que sin él la carpeta se ordenaría por hora
  de subida y no por cuándo se hizo cada foto. Ordenar por nombre = orden cronológico real.
- **No hay deduplicación**: dos invitados con la misma foto generan dos archivos (Drive lo permite).
- Si el canvas no puede decodificar una imagen (típico con **HEIC en Android**), se sube el original
  sin comprimir en lugar de perder la foto. Hay un tope de 12 MB para ese caso.
- Todo decode de imagen lleva un **temporizador de seguridad** (`DECODE_TIMEOUT_MS`): sin él, un
  formato no soportado dejaba la cola congelada para siempre.
- La web app debe desplegarse con acceso "Cualquier persona" y ejecutándose **como el propietario**,
  para que los invitados no necesiten permisos sobre la carpeta de Drive.
- El endpoint es **público y sin autenticar**: cualquiera con la URL puede escribir en la carpeta.
  Por eso `uploadFile` valida que el tipo sea `image/*` y limita el tamaño a 15 MB.

### `app_formulario/` — Información de alérgenos y peticiones de canciones

Formulario con dos pestañas independientes: los alérgenos de cada comensal y las canciones que el
invitado quiere oír. Todo acaba en **una hoja de cálculo con dos pestañas**.

Flujo:

1. El invitado abre la web app: portada, cuenta atrás al `22/08/2026 12:00` y dos pestañas.
2. **Alérgenos**: nombre, sus alérgenos, acompañantes adultos y niños (con edad y menú infantil), y
   un mensaje libre. Cada persona tiene su propia fila de alérgenos. El botón **"Enviar
   información"** llama a `enviarRespuesta(data)`, que escribe una fila **por persona** en
   `Invitados`.
3. **Tus canciones**: quién las pide, busca en Spotify y va montando una lista. El botón **"Enviar
   canciones"** llama a `enviarCanciones(data)`, que escribe una fila **por canción** en `Canciones`.
4. Cada pestaña tiene su propio mensaje de gracias, y al enviar se hace scroll hasta él: el
   formulario es largo y, si no, el invitado se queda arriba pensando que no ha pasado nada.

Archivos:

- [app_formulario/code.gs](app_formulario/code.gs) — `doGet()`, `enviarRespuesta(data)`,
  `enviarCanciones(data)`, `buscarCanciones(query)`, más `crearHojaDeCalculo()` y
  `comprobarConfiguracion()` para el montaje.
- [app_formulario/index.html](app_formulario/index.html) — frontend autocontenido: paleta vino
  (`--wine: #8c1d24`) sobre crema, Cormorant Garamond + Jost incrustadas, los 14 alérgenos de la UE
  dibujados en SVG y cuenta atrás.

Puntos a tener en cuenta al tocar esta app:

- **La búsqueda de Spotify va en el servidor**, con _Client Credentials_ (token de la aplicación).
  No es un capricho: desde febrero de 2026 el modo desarrollo de Spotify limita a **5 usuarios y
  exige Premium**, y la cuota ampliada pide una empresa registrada con 250k usuarios/mes. Con PKCE
  en el navegador —lo que traía el export original— el formulario solo habría funcionado para 5
  invitados. Con el token de aplicación, el invitado ni se entera de que hay Spotify detrás.
- `SPREADSHEET_ID`, `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` van **vacías en el repositorio**,
  igual que en `app_fotos`. Se rellenan en el editor o, mejor para el secreto, como propiedades de
  script con esos mismos nombres. `ajuste_()` prueba primero la constante y luego la propiedad.
- **Una fila por persona, no por respuesta**: la columna `Grupo` repite el nombre de quien envía,
  así se puede filtrar por familia y a la vez contar comensales y sumar alergias sin trocear celdas.
- **Los dos envíos son independientes a propósito**: se puede pedir música sin confirmar (quien no
  viene también quiere que suene su canción) y confirmar sin pedir música, y volver otro día a
  añadir más canciones sin reenviar la confirmación. Lo único obligatorio en ambos es el nombre
  (`quien_()`), que en la pestaña de canciones se hereda del que ya haya escrito en la confirmación.
  Los acompañantes, en cambio, **solo se guardan si el invitado viene**.
- `/v1/search` de Spotify **devuelve como mucho 10 resultados**; el backend pide 8 a propósito.
- Hay topes en el backend (`MAX_ACOMPANANTES`, `MAX_NINOS`, `MAX_CANCIONES`, `MAX_TEXTO`) porque el
  endpoint es público: sin ellos una sola petición podría llenar la hoja.
- Las filas de acompañante que el invitado añade y deja en blanco **se descartan** en cliente y en
  servidor.
- Las tipografías van **incrustadas en base64** dentro del HTML (subconjunto latino, variables):
  el export original también las traía embebidas y es la única forma de conservar el diseño sin CDN.

## Convenciones

- **Idioma**: el texto de cara al invitado va en el idioma de cada app: `app_fotos` está en **gallego**
  y `app_formulario` en **español**. Los comentarios de código y los mensajes de diagnóstico que solo
  ve quien monta la app (`comprobarConfiguracion()`, `console.log`) van **siempre en español**,
  aunque la app esté en gallego.
- **Estructura**: una carpeta por utilidad, en la raíz, con nombre `app_<cosa>` (ej. `app_fotos`).
- **Un solo aspecto para todas las apps**: paleta vino sobre crema, Sacramento / Cormorant Garamond /
  Jost incrustadas, y la portada con guirnalda y bola de espejos. El invitado abre dos enlaces
  distintos el mismo día y tienen que parecer de la misma boda. La referencia viva es
  [app_formulario/index.html](app_formulario/index.html): al hacer una app nueva, se copian de ahí
  las variables de `:root`, los `@font-face`, la cabecera y los botones (`.btn-solid`, `.btn-line`).
- **Sin build**: nada de npm, bundlers ni transpilación. HTML/CSS/JS plano y `.gs`.
- **Cero dependencias externas en tiempo de ejecución**: nada de CDN. Un salón con cobertura mala o
  portal cautivo dejaría la página sin maquetar justo cuando más se usa. CSS inline, e iconos como
  emoji o SVG dibujado a mano en vez de una fuente de iconos. Si un diseño necesita una tipografía
  concreta, se incrusta en base64 (woff2, subconjunto latino, `font-display: swap`) y se declara
  siempre una familia del sistema detrás. Diseño mobile-first: los invitados lo abren desde el móvil.
- **Manejo de errores**: las funciones de Apps Script devuelven `{ success: true, ... }` o
  `{ success: false, error: "..." }` en lugar de lanzar excepciones, y el frontend renderiza el mensaje.
  Solo se devuelven al cliente los mensajes marcados con `userError_()`; el resto se registra con
  `console.error` y se sustituye por un texto genérico, para no filtrar detalles de configuración.
- **Todo fallo debe tener salida**: cualquier operación que pueda no terminar (decodificar una imagen,
  una petición de red) necesita temporizador o manejador de error, y el invitado debe poder reintentar.
  Quedarse con un botón muerto o un "cargando" eterno es el peor resultado posible el día de la boda.

## Despliegue (Apps Script)

Común a las dos apps:

1. Crear un proyecto nuevo en [script.google.com](https://script.google.com) (uno **por app**).
2. Copiar el contenido de `code.gs` en el archivo de script.
3. Crear un archivo HTML llamado `Index` (con mayúscula) y pegar el contenido de `index.html`.
4. Rellenar la configuración (ver abajo) y guardar con Ctrl+S.
5. Ejecutar `comprobarConfiguracion()`: autoriza los permisos y comprueba de verdad que se escribe.
6. Desplegar → Nueva implementación → **Aplicación web**, ejecutar como "Yo", acceso "Cualquier persona".
7. Repartir la URL (o un QR generado a partir de ella) a los invitados.

Configuración de `app_fotos` (paso 4): pegar el id de la carpeta de Drive en `FOLDER_ID`.
Alternativa: dejarla vacía y crear la propiedad de script `DRIVE_FOLDER_ID`.

Configuración de `app_formulario` (paso 4):

- Si aún no hay hoja, ejecutar **`crearHojaDeCalculo()`** una vez: crea el libro con las dos
  pestañas y deja el id en el registro.
- Pegar ese id en `SPREADSHEET_ID`.
- En [developer.spotify.com](https://developer.spotify.com/dashboard), en la app ya creada, copiar
  _Client ID_ y _Client secret_. El **secreto** conviene guardarlo como propiedad de script
  (`SPOTIFY_CLIENT_SECRET`) y dejar la constante vacía. **No hace falta configurar Redirect URI**:
  con Client Credentials no hay login de usuario.

Después de **cada cambio en el código hay que crear una implementación nueva**: la URL repartida
apunta a una versión concreta y sigue sirviendo la anterior hasta que se publica otra.

Antes del día: probar desde un iPhone y desde un Android reales. En `app_fotos`, subir varias fotos
a la vez y activar el modo avión a media subida, para ver que la cola se recupera al reintentar. En
`app_formulario`, enviar una respuesta de prueba y borrar luego sus filas de las dos pestañas.

## Ideas para futuras utilidades

Cualquier app nueva debería seguir el mismo patrón: carpeta propia, Apps Script, cero infraestructura.
Ejemplos del tipo de cosas que encajan aquí: asignación de mesas (leyendo la pestaña `Invitados`),
lista de regalos, generación de la playlist real a partir de la pestaña `Canciones`, o un panel de
seguimiento de presupuesto sobre Sheets.
