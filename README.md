# Data Recruit

Create scrolling image-and-data videos. Built by Clatasha on the Reaction Station editor (OpenScreen, MIT).

![Data Recruit builder with sample image placeholders](docs/images/data-recruit-builder.jpg)

## First version

1. Select numbered images: `1.jpg`, `2.jpg`, or `01 - Movie.jpg`.
2. Choose **Salary per movie**, **Facts & comparisons**, or save your own field/color template.
3. Choose **16:9 Landscape** or **9:16 Shorts**.
4. Import a numbered `.txt` file and click **Build Timeline**.
5. Preview, change speed/direction, adjust image crops, and export a 1080p 30 FPS MP4.

Example text (each field maps to its own template section regardless of order):

```text
1
Title: Crash
Year: 2004
Budget: $6.5M
Box Office: $98.4M
Paycheck: $1M

2
Title: Loverboy
Year: 2005
Budget: $6M
Box Office: $53.5K
Paycheck: $1M
```

Missing fields, duplicate numbers and unmatched images are reported before building. Titles wrap and shrink to fit their section. Images retain their aspect ratio: **Fill** crops, **Fit** adds a dark background. Each image has horizontal and vertical crop controls.

Templates can have 1–6 named data rows, each with a background color. Save custom templates for reuse. Salary is a starting preset, not a restriction on content.

**Save project** downloads a portable JSON containing the data, template, image files, crop settings, format and image bookends. **Open project** restores it. Save this file before closing if you want to edit the cards later.

Optional intro/outro images have adjustable duration. **Continue in Editor** renders the sequence into a video clip in the inherited editor, where you can add video intros/outros, music, narration, text and other media. **Return to builder** keeps your card setup available during the session. Rebuilds create a new editor project; they do not overwrite earlier edits.

## Testing builds

The **Data Recruit Windows test** Actions workflow bootstraps the Reaction Station base and builds an unsigned Windows installer. Download its `data-recruit-windows-test` artifact after the run succeeds. This is an early test build, not a stable release.

## Development

Node 22.22.1 and npm 10.9.4. Run `npm ci`, then `npm run dev`. Browser preview: `NO_ELECTRON=1 npm run dev -- --host 127.0.0.1`, open `http://127.0.0.1:5173/?windowType=data-recruit`. MP4 export needs Chromium's H.264 WebCodecs encoder. Desktop timeline finishing uses the inherited native compositor.

Run `npx tsc --noEmit`, `npx tsc -p tsconfig.test.json --noEmit`, `npm test`. Build Windows: `npm run build:win -- --publish never`.

## Credits

Reaction Station, OpenScreen, Siddharth Vaddem and the OpenScreen contributors. Original MIT license and third-party notices are retained.
