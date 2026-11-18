# Reproductor de audio web con visualizador

Reproductor de audio 100 % local (sin servidor, sin dependencias): cola de reproducción,
visualizador con `AnalyserNode` y ecualizador de 5 bandas con `BiquadFilterNode`.

## Arranque

Al usar `blob:` para los ficheros locales, hay que servirlo por HTTP:

```bash
cd reproductor-musica
python3 -m http.server
# abrir http://localhost:8000/index.html
```

También vale cualquier servidor estático (`npx serve`, extensión Live Server, etc.).
Todo el audio se queda en tu máquina: no se sube nada a ningún servidor.

## Uso

- **Añadir música:** arrastra ficheros a cualquier parte de la ventana o usa «Elegir ficheros».
- **Cola:** clic para saltar a una pista, ✕ para quitarla, «Vaciar» para limpiarla.
  Avance automático, modo aleatorio y repetir todo / una / no.
- **Progreso:** arrastra la barra para buscar; funciona también en pausa.
- **Tono prueba:** genera 2 s de tono para ver el visualizador sin tener ficheros a mano.

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `Espacio` | play / pausa |
| `N` / `P` | siguiente / anterior |
| `←` / `→` | ∓ 5 s (`Shift` = ∓ 10 s) |
| `↑` / `↓` | volumen |
| `M` | mute |
| `B` / `V` / `O` | visualizador barras / onda / off |
| `Supr` | quita la pista actual |

## Arquitectura

```text
<audio> → MediaElementSource → EQ (5× Biquad) → Analyser → destination
```

- Se usa `<audio>` + `MediaElementSource` (no `AudioBufferSource`) para que
  el seek sea trivial (`audio.currentTime = …`), incluso en pausa.
- **EQ:** lowshelf 60 Hz, peaking 250 Hz / 1 kHz / 4 kHz, highshelf 12 kHz.
  Ganancias con `setTargetAtTime` para evitar crujidos; 7 preajustes + custom.
- **Visualizador:** `getByteFrequencyData` (barras) / `getByteTimeDomainData` (onda)
  dibujados en `canvas` con un único `requestAnimationFrame`.

## Rendimiento

El audio y el canvas están desacoplados: si el dibujado va lento, el audio no se corta.
Medidas aplicadas:

- Throttle del dibujado a ~30 fps (15 fps en modo eco).
- `fftSize: 1024`, buffers `Uint8Array` reutilizados (cero asignaciones en el bucle).
- `DPR ≤ 1.5`, gradiente creado una sola vez, sin sombras ni efectos caros.
- `ctx { alpha: false, desynchronized: true }`; sin dibujado con pestaña oculta.
- **Degradado Auto:** si un frame cuesta > 12 ms de forma sostenida, baja a mitad
  de resolución y 48 barras. Forzable con el botón ⚡ (`Auto / Eco / Full`), con lector de fps.

## Estructura

```text
index.html  – estructura (transporte, visualizador, EQ, cola, ayuda)
styles.css  – estilos, sin framework
app.js      – cola, motor de audio, visualizador, atajos
```

## Compatibilidad

Navegadores actuales con Web Audio API. Requiere gesto de usuario para arrancar
el `AudioContext` (pulsa play o cualquier control).
