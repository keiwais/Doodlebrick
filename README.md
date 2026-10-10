# DoodleBrick

Build a picture from shapes, trace any photo, and get a live accuracy score. An AI coach tells you what to fix next.

> **Status: working prototype.** Everything described below runs today. Items under [Roadmap](#roadmap) do not exist yet.

## How the AI is used

| Feature                                            | Where it runs  | What it is                                                                                                      |
| -------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Photo → outline (edge detection)                   | On your device | Sobel gradients + non-max suppression (`vision.js`)                                                             |
| Tracing accuracy score                             | On your device | Recall/precision against the outline, distance-transform based. **Deterministic** — no model decides your score |
| Shape detection, palette, next-shape ghost         | On your device | Colour-region segmentation, k-means, coverage maps                                                              |
| Identify the photo ("tabby cat 87%")               | On your device | TensorFlow.js **MobileNet** image classifier (downloads ~15 MB once)                                            |
| Style filters (Cartoon, Watercolor, Anime, Sketch) | On your device | Pixel maths — works offline                                                                                     |
| **Generate with AI** (restyle your drawing)     | Local ComfyUI, or Google Gemini | SD 1.5 image-to-image on your computer (ComfyUI), or a Gemini image model in the cloud                                                               |
| **Get a drawing tip** (plain-words feedback)       | On your device, or Gemini | Rule-based tips from the tracing score by default. With `GEMINI_API_KEY` set, an AI coach (Google Gemini) looks at your drawing after you accept a consent prompt |
| Suggest animation, auto-name layers, smooth lines, brush-size suggestion | On your device | Rule-based helpers, **not machine learning** (see the maths below) |

"Generate with AI" has two modes. **Local mode** (`AI_PROVIDER=comfyui`) needs ComfyUI and a compatible NVIDIA GPU: the browser sends the drawing to the DoodleBrick server on your computer, which forwards it only to local ComfyUI, with no cloud key or per-image fee. **Cloud mode** (the default) uses a free Google Gemini key and needs no GPU. The drawing-tip coach uses the same Gemini key in either mode.

## The maths

All of this lives in `vision.js` (no libraries) and `script.js`. The analysis works on a 480×270 grid; the canvas is 960×540.

### 1. Photo → outline

```
Grayscale        Y = 0.299 R + 0.587 G + 0.114 B
Blur             3×3 box blur, repeated 3 / 2 / 1 times (Simple / Balanced / Detailed)

Sobel, on the 3×3 neighbourhood      a b c
                                     d · f
                                     g h i

  Gx = (c + 2f + i) − (a + 2d + g)
  Gy = (g + 2h + i) − (a + 2b + c)
  |G| = sqrt(Gx² + Gy²)
  θ   = atan2(Gy, Gx), snapped to 0°, 45°, 90° or 135°
```

A pixel is kept only if `|G| ≥ T` **and** `|G|` is at least as large as both neighbours along θ (non-maximum suppression), which gives 1-pixel-wide edges.

```
T = max( magnitude at the top `keep` fraction of pixels, r · max|G| )
```

The "top fraction" is found from a 512-bin histogram of `|G| / max|G|`. Edge fragments smaller than `minComp` pixels (8-connected) are removed.

| Detail   | blur passes | keep | r    | minComp |
| -------- | ----------- | ---- | ---- | ------- |
| Simple   | 3           | 5%   | 0.16 | 40 px   |
| Balanced | 2           | 8%   | 0.11 | 22 px   |
| Detailed | 1           | 13%  | 0.07 | 10 px   |

### 2. Tracing accuracy score

Distances come from a chamfer 3-4 distance transform (weight 3 for straight steps, 4 for diagonal, result divided by 3 to get pixels).

```
dE(p) = distance from p to the nearest outline pixel
dM(p) = distance from p to the nearest pixel you drew

Recall     R = |{ p in outline         : dM(p) ≤ t     }| / |outline|
Precision  P = |{ b on drawing boundary : dE(b) ≤ t + 3 }| / |drawing boundary|

score = round( 100 · 2PR / (P + R) )          (an F1 score)
```

- Tolerance `t` is 16 / 9 / 5 canvas pixels for Easy / Medium / Hard (halved on the 480×270 analysis grid).
- The score is not shown if the outline has fewer than 30 pixels, and is 0 if you have drawn fewer than 12.
- Recall alone would reward scribbling everywhere; precision alone would reward one tiny line. The F1 needs both, so a blank canvas, a drawing in the wrong place and a flood-fill all score 0 while a perfect trace scores 100 (checked in `tests/test_vision.js`).

### 3. Colour palette (k-means)

- Sample about 4,000 pixels, skipping transparent ones.
- Start from the pixel closest to the mean colour, then add the pixel farthest from all centres until there are k = 6 (deterministic, no randomness).
- Run 8 iterations of assign-to-nearest and recompute-mean in RGB.
- Merge centres closer than 28 in RGB distance, then sort by share of pixels.

### 4. Shape detection

1. Quantise each colour channel to 4 levels (64 colours total) after a light blur.
2. Find 4-connected regions; ignore regions under 0.4% of the image, background-sized regions, and large regions that hug the border.
3. Classify each region from `fill = area / (width · height)`, its aspect ratio and the height of its centroid inside its box:

| fill      | result                                                        |
| --------- | ------------------------------------------------------------- |
| ≥ 0.93    | square (aspect within 0.16 of 1) or rectangle                 |
| 0.86–0.93 | rounded box                                                   |
| 0.70–0.86 | half circle (low centroid), circle (aspect ≈ 1) or ellipse    |
| 0.58–0.70 | heart (high centroid) or cloud                                |
| 0.40–0.58 | triangle (low centroid), diamond or star                      |

Very thin regions (short side under 12% of the long side) are called lines.

### 5. Composition and quality scores

```
Balance     = 100 · (1 − min(1, distance of the ink centroid from the canvas centre))
Contrast    = 100 · ( 0.6 · min(1, |mean brightness − background| / 128)
                    + 0.4 · min(1, brightness std-dev / 64) )
Alignment   = share of shapes whose centre lines up (within 8 px) with the canvas
              centre or another shape's centre
Composition = average of the scores that exist

Line quality = 100 · (1 − min(1, mean turning angle between stroke segments / 0.9 rad))
Colour harmony = 100 − 70 · (share of colour pairs whose hues are 60°–150° apart)
```

### 6. Adaptive difficulty

Average the last 3 saved scores. Below 45 → Easy, below 70 → Medium, otherwise Hard. With no saved scores it starts on Easy. In the interface you pick Easy, Hard or Adaptive; Adaptive is the only way to land on Medium.

### 7. Smoothing, helpers and animation

- **Stroke clean-up:** on release a stroke is simplified with Ramer–Douglas–Peucker (ε = 0.35). "Smooth & clean lines" applies a [1, 2, 1] / 4 kernel twice, then simplifies again (ε = 0.6).
- **Brush-size suggestion:** with a photo, `size = clamp( mean(min(w, h)) of detected shapes / 14, 3, 40 )`; without one, `clamp( 10 / zoom, 2, 40 )`.
- **Auto-name layers:** colour name from the hue/saturation/brightness, shape kind from geometry (a stroke whose radius varies by under 20% is a circle).
- **Suggest animation:** a lookup from shape type to a preset loop (circles bob, stars spin, squares pulse, triangles wiggle, clouds drift). This is a rule, not a model.
- **Keyframes:** values between keyframes use smoothstep, `e = u² (3 − 2u)`, over a 4-second timeline.

### 8. Style filters (pure pixel maths)

- **Cartoon:** box blur (r = 2), saturation × 1.28, posterise to 4 levels, draw ink where Sobel magnitude > 70.
- **Anime:** posterise brightness to 5 bands, add a soft bloom, ink lines where magnitude > 110.
- **Watercolor:** blend two blurs, posterise to 9 levels, wobble pixels with a smooth random field, add paper grain.
- **Sketch:** colour-dodge of the grayscale image over its blurred inverse.

## Run it

There are two ways to run DoodleBrick. There is nothing to `npm install`.

### Option A: on-device features only (no setup)

Open `index.html` in Chrome or Edge. Drawing, shapes, tracing, the accuracy score, photo identification, style filters, animation and the gallery all work. The AI buttons that need a server explain that none is connected. "Identify photo" downloads the ~15 MB MobileNet model the first time, so it needs an internet connection once.

### Option B: full setup with local AI

**You need:** [Node.js 18+](https://nodejs.org), [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (the Windows portable build) with a Stable Diffusion 1.5 checkpoint, and an NVIDIA GPU.

1. **Create your settings file.** Copy `.env.example` to `.env`, then remove the `#` in front of these three lines so DoodleBrick uses local ComfyUI:
   ```
   AI_PROVIDER=comfyui
   COMFYUI_BASE=http://127.0.0.1:8188
   COMFYUI_CHECKPOINT=v1-5-pruned-emaonly-fp16.safetensors
   ```
   `COMFYUI_CHECKPOINT` must match the file name of your Stable Diffusion 1.5 checkpoint in ComfyUI's `models/checkpoints` folder.
2. **Start ComfyUI first.** Run `run_nvidia_gpu.bat` from your ComfyUI folder (for example `%USERPROFILE%\AI-Setup\ComfyUI_windows_portable\run_nvidia_gpu.bat`) and wait until it says it is running on `http://127.0.0.1:8188`.
3. **Start DoodleBrick** in a second window:
   ```bash
   node server/server.js
   ```
4. **Open** `http://localhost:8787`.
5. **Check the connection.** Choose the Trace tool and look under "Photo helpers". If the "AI server not connected" note is gone, the server is connected. You can also open `http://localhost:8787/api/health`.
6. **Try it.** Draw something, open **AI Studio**, press **Generate with AI**, and accept the consent prompt. The first image can take about a minute.

Keep both ComfyUI and the DoodleBrick server running while you use Generate with AI. Without ComfyUI, the app still has its built-in on-device filters.

**Drawing-tip coach (Google Gemini):** get a free key at <https://aistudio.google.com/apikey>, paste it after `GEMINI_API_KEY=` in `.env`, and restart `node server/server.js`. It works together with local ComfyUI. Without a key, "Get a drawing tip" gives built-in tips instead. Never commit your `.env` file or share your key.

### Option C: cloud AI with a free Gemini key (no GPU, no ComfyUI)

1. Copy `.env.example` to `.env`.
2. Get a free key at <https://aistudio.google.com/apikey> and paste it after `GEMINI_API_KEY=`.
3. Leave `AI_PROVIDER` commented out, then run `node server/server.js` and open `http://localhost:8787`.

"Generate with AI" and "Get a drawing tip" now both use Gemini (`GEMINI_IMAGE_MODEL` and `GEMINI_TEXT_MODEL`, defaulting to `gemini-2.5-flash-image` and `gemini-2.5-flash`).

**Test mode:** set `MOCK_AI=1` in `.env` to run the whole AI flow with canned results. No key, no internet and no GPU are needed, which makes it handy for trying every button.

### Settings reference

| Setting | What it does |
| --- | --- |
| `GEMINI_API_KEY` | Turns on Gemini for the drawing-tip coach (and cloud image generation) |
| `AI_PROVIDER=comfyui` | "Generate with AI" runs on your own computer through ComfyUI |
| `COMFYUI_BASE`, `COMFYUI_CHECKPOINT` | Where ComfyUI is running, and which checkpoint file to use |
| `GEMINI_IMAGE_MODEL`, `GEMINI_TEXT_MODEL` | Which Gemini models to use |
| `MOCK_AI=1` | Test the AI flow with canned results |
| `ALLOWED_ORIGIN` | Allow only your own hosted front-end to call the server |
| `RATE_PER_MINUTE`, `MAX_DAILY_CALLS` | Protect your key from abuse |
| `PORT` | Server port (default 8787) |

### Troubleshooting

| Problem | Fix |
| --- | --- |
| "AI server not connected" | Start `node server/server.js` and open the app from `http://localhost:8787`, not by double-clicking `index.html`. |
| Generate shows the on-device filter instead | ComfyUI is not running or `COMFYUI_BASE` is wrong. Start ComfyUI and try again. |
| Generate fails in local mode | `COMFYUI_CHECKPOINT` must exactly match a file in ComfyUI's `models/checkpoints` folder. |
| Generate is very slow | The first image loads the model. Later images are faster. |
| Identify photo says it couldn't identify | The MobileNet model needs internet once to download. |

## Deploy

- Local ComfyUI is intended for this computer only; do not expose port 8188 to the internet.
- If the front-end is hosted separately (for example GitHub Pages), set `window.DOODLEBRICK_API` in `config.js` to your server's URL and set `ALLOWED_ORIGIN` in `.env` to your front-end's address.
- Keep `RATE_PER_MINUTE` and `MAX_DAILY_CALLS` set when using a Gemini key on a public server.

## Privacy

- Photos never leave your device. Only your **drawing** is processed, after you accept a consent prompt and press Generate. In local mode that happens on your computer through ComfyUI; in cloud mode the drawing goes to Google Gemini.
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

- This is a prototype built for a hackathon, not a finished product.
- Local image generation depends on ComfyUI, its checkpoint, GPU memory, and the installed NVIDIA driver.
- Shape detection is tuned on clean shapes; busy real photos are rougher.
- The classifier uses ImageNet classes, so it names objects/animals, not abstract scenes.
- Touch/stylus pressure and mobile layout testing are not done yet.

## Roadmap

- Guided lessons such as "draw a cat in 5 shapes", with badges and a simple kid mode.
- Hosted image generation with parental consent, so it works without a local GPU.
- Touch, stylus and mobile support.
- Classroom mode for teachers, plus accounts and cloud sync.
- Split `script.js` into modules (canvas, tools, history, AI, storage).

## Files

```
index.html  style.css  script.js   the app
vision.js                          computer-vision helpers (no dependencies)
config.js                          where the AI server lives
server/server.js                   static server + /api/generate, /api/coach (holds the key)
tests/                             vision, app and server tests
```