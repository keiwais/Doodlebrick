# DoodleBrick

**Scratch for drawing.** Build a picture from shapes, trace any photo, and get a live accuracy score. An AI coach tells you what to fix next.

## How the AI is used

| Feature                                            | Where it runs  | What it is                                                                                                      |
| -------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Photo → outline (edge detection)                   | On your device | Sobel gradients + non-max suppression (`vision.js`)                                                             |
| Tracing accuracy score                             | On your device | Recall/precision against the outline, distance-transform based. **Deterministic** — no model decides your score |
| Shape detection, palette, next-shape ghost         | On your device | Colour-region segmentation, k-means, coverage maps                                                              |
| Identify the photo ("tabby cat 87%")               | On your device | TensorFlow.js **MobileNet** image classifier (downloads ~15 MB once)                                            |
| Style filters (Cartoon, Watercolor, Anime, Sketch) | On your device | Pixel maths — works offline                                                                                     |
| **Generate with AI** (restyle your drawing)     | Local ComfyUI  | SD 1.5 image-to-image checkpoint on your computer                                                               |
| **Get a drawing tip** (plain-words feedback)       | On your device, or Gemini | Rule-based tips from the tracing score by default. With `GEMINI_API_KEY` set, an AI coach (Google Gemini) looks at your drawing after you accept a consent prompt |

Local image generation requires ComfyUI and a compatible NVIDIA GPU. The browser sends the drawing to the DoodleBrick server on your computer, which forwards it only to local ComfyUI. No cloud API key or per-image fee is needed for image generation. The optional AI coach uses a free Gemini key.

## Run it

You need [Node.js 18+](https://nodejs.org). There is nothing to `npm install`.

```bash
# 1. Start local ComfyUI first, then start DoodleBrick
#    ComfyUI launcher: %USERPROFILE%\AI-Setup\ComfyUI_windows_portable\run_nvidia_gpu.bat
node server/server.js
# open http://localhost:8787
```

The local setup uses `AI_PROVIDER=comfyui` and `COMFYUI_BASE=http://127.0.0.1:8188` in `.env`. Keep both ComfyUI and the DoodleBrick server running while using Generate with AI. Without ComfyUI, the app still has its built-in on-device cartoon filters.

You can also open `index.html` directly. Everything on-device works, and the AI buttons explain that no server is connected.

## Deploy

- Local ComfyUI is intended for this computer only; do not expose port 8188 to the internet.

## Privacy

- Photos never leave your device. Only your **drawing** is processed by local ComfyUI after you accept a consent prompt and press Generate.
- If you turn on the optional AI coach, your drawing and the faint outline (never the original photo) are sent to Google Gemini, only after a separate consent prompt and only when you press the tip button.
- The classifier model is downloaded to the browser and runs locally.
- Because beginners and kids are the audience: ask a parent/teacher first if under 13, and review the provider's terms before deploying publicly.

## Tests

```bash
npm test      # or run the three files in tests/ with node
```

- `test_vision.js` — outline, scoring (perfect trace = 100; blank, wrong place and flood-fill = 0), shape detection, palette, filters
- `test_app.js` — drives the real `script.js` in a simulated page: drawing, shapes, move/resize, undo/redo, fill, layers, animation, save/load, filters, and every AI flow (server online/offline/errors, consent declined, classifier, lessons)
- `test_server.js` — the real server against fake Gemini and ComfyUI services: request formats, local image workflow, key handling, error mapping, CORS and path safety

## Honest limits

- Local image generation depends on ComfyUI, its checkpoint, GPU memory, and the installed NVIDIA driver.
- Shape detection is tuned on clean shapes; busy real photos are rougher.
- The classifier uses ImageNet classes, so it names objects/animals, not abstract scenes.
- Touch/stylus pressure, mobile layout testing and Filipino/Bisaya UI are not done yet.

## Files

```
index.html  style.css  script.js   the app
vision.js                          computer-vision helpers (no dependencies)
config.js                          where the AI server lives
server/server.js                   static server + /api/generate, /api/coach (holds the key)
tests/                             vision, app and server tests
```