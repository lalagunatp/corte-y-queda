# Montaje

Editor de vídeo **local, gratuito y sin marca de agua**, para el navegador y para Windows (Tauri).

Es un proyecto original. No contiene código, recursos ni marcas de CapCut o ByteDance. Su arquitectura
se inspira en lo que hacen los editores modernos en el navegador (WebCodecs, Web Audio, IA local)
y sus prioridades salen de las quejas más repetidas de los usuarios de editores gratuitos:

| Queja frecuente de los usuarios | Respuesta en Montaje |
| --- | --- |
| Funciones que eran gratis pasan a "Pro" | Todo está incluido; no hay niveles de pago. |
| Exportación bloqueada o con marca de agua | Exporta MP4 hasta 4K, sin marca de agua ni límites. |
| Términos que dan licencia sobre tu contenido; subida a la nube | Sin cuenta ni servidor: los archivos y el proyecto se quedan en tu equipo (IndexedDB). |
| Funciones distintas entre web y escritorio | Una sola base de código para las dos versiones. |
| Subtítulos automáticos de pago o en la nube | Whisper corre en tu equipo (WebGPU o WASM). |
| Edición poco precisa | Atajos profesionales (J/K/L, S, flechas por fotograma), imán, deshacer ilimitado (200 pasos). |

## Funciones

- Importar vídeo, audio e imágenes (botón o arrastrar y soltar).
- Línea de tiempo multipista (vídeo, audio y texto): mover, recortar por los bordes, dividir, duplicar, eliminar, imán.
- Vista previa en tiempo real con volumen, fundidos, velocidad (0,25×–4×), escala, posición, rotación,
  opacidad, brillo, contraste y saturación.
- Texto con color, fondo, negrita, posición y fundidos.
- Transiciones: superpón dos clips en la misma pista y usa fundido de salida y de entrada.
- Formatos 16:9, 9:16, 1:1 y 4:5; 24–60 fps.
- **Subtítulos automáticos** con Whisper local (tiny, base o small) y división en líneas legibles.
- **Limpieza de voz**: paso alto, paso bajo, realce de presencia y compresor.
- Exportación MP4 (H.264 + AAC) con WebCodecs, de 480p a 4K.
- Autoguardado local del proyecto y de los medios.

## Uso

Requisitos: Node.js 20 o superior. Para la versión web: Chrome o Edge (WebCodecs).

```bash
npm install
npm run dev
```

Abre http://localhost:5173.

### Atajos

| Tecla | Acción |
| --- | --- |
| Espacio / K / L | Reproducir-pausa / pausa / reproducir |
| J | Retroceder 5 s |
| ← / → | Fotograma anterior / siguiente (con Mayús: 1 s) |
| S | Dividir en el cabezal |
| Supr | Eliminar selección |
| Ctrl+D | Duplicar |
| Ctrl+Z / Ctrl+Y | Deshacer / rehacer |
| T | Añadir texto |
| + / − | Acercar / alejar la línea de tiempo |

## Versión de escritorio (Tauri)

La app de escritorio usa el mismo editor dentro de WebView2. Para compilarla hace falta
[Rust](https://www.rust-lang.org/tools/install) y las herramientas de compilación de C++ de Visual Studio.

```bash
npm run tauri dev     # ventana de desarrollo
npm run tauri build   # instalador .msi / .exe en src-tauri/target/release/bundle
```

## Arquitectura

```
src/
  types.ts            modelo del proyecto (pistas, clips, recursos)
  store.ts            estado (zustand) con historial de deshacer/rehacer
  media.ts            dueño de los archivos: IndexedDB, URL de objeto, audio decodificado
  persistence.ts      autoguardado local
  engine/
    compositor.ts     dibuja un fotograma del proyecto en un canvas (vista previa y exportación)
    preview.ts        sincroniza un elemento <video>/<audio> por clip y enruta el audio por Web Audio
    audioMix.ts       mezcla sin conexión a 48 kHz (OfflineAudioContext)
    exporter.ts       fotogramas → VideoEncoder (H.264), mezcla → AudioEncoder (AAC), mp4-muxer
  ai/
    captions.ts       extrae el audio del clip a 16 kHz mono y crea los clips de texto
    captionsWorker.ts Whisper (transformers.js) en un Web Worker
  components/         interfaz (biblioteca, vista previa, línea de tiempo, inspector, exportación)
src-tauri/            contenedor de escritorio
```

## Limitaciones conocidas

- La exportación busca cada fotograma en el vídeo fuente: es fiable pero más lenta que un decodificador dedicado en proyectos largos.
- Los clips pueden superponerse en una pista; el que empieza después se dibuja encima.
- Whisper puede inventar texto en tramos sin voz (música, tonos). Revisa los subtítulos antes de exportar.
- La primera vez que generas subtítulos se descarga el modelo desde Hugging Face (40–250 MB); después queda en caché.
- No hay todavía archivo de proyecto portable para moverlo a otro equipo.
