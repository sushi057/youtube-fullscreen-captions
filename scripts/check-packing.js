// Packs inside the overlay's own DOM, which is where the class-name bug hid.
// Asserts the drawn page never exceeds the box, at every font and size.

const fs = require("node:fs");
const puppeteer = require("puppeteer-core");

// Set CHROME_PATH if your browser lives elsewhere.
const CHROME =
  process.env.CHROME_PATH ||
  "/home/sushi/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome";
const EXT = require("node:path").join(__dirname, "..", "extension");

const view = fs.readFileSync(`${EXT}/caption-view.js`, "utf8");
const css = fs.readFileSync(`${EXT}/overlay.css`, "utf8");

const FONTS = {
  sans: '"Archivo", "Roboto", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Roboto Mono", Consolas, monospace',
  dyslexic: '"OpenDyslexic", "Comic Sans MS", sans-serif',
};
const SCALES = { s: 0.75, m: 1, l: 1.3 };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox"],
  });
  let failures = 0;

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1920, height: 960 },
    { width: 1600, height: 640 },
  ]) {
    const page = await browser.newPage();
    await page.setViewport(size);
    // The overlay's real markup: note the caption carries cm-caption, and the
    // site's stylesheet (which defines .caption) is deliberately absent.
    await page.setContent(
      `<style>${css}</style>
       <div id="caption-mode-overlay">
         <div class="cm-stage"><div class="cm-caption caption"></div></div>
         <div class="cm-controls"><div class="cm-bar"></div></div>
       </div>
       <script>${view}</script>`,
    );

    for (const [fontName, stack] of Object.entries(FONTS)) {
      for (const [sizeName, scale] of Object.entries(SCALES)) {
        const res = await page.evaluate(
          (stack, scale) => {
            const root = document.getElementById("caption-mode-overlay");
            const cap = document.querySelector(".cm-caption");
            const stage = document.querySelector(".cm-stage");
            root.style.setProperty("--cm-font", stack);
            root.style.setProperty("--cm-scale", String(scale));

            const words = Array.from({ length: 1500 }, (_, i) => ({
              start: i * 0.4,
              text: ["limitations", "question", "human", "possibility", "go"][
                i % 5
              ],
            }));
            const packed = CaptionView.packPages(
              words,
              cap,
              4,
              stage.clientHeight,
            );

            // Draw each page for real and measure what the reader would see.
            let worstLines = 0;
            let overflowing = 0;
            const lineH = parseFloat(getComputedStyle(cap).lineHeight) || 60;
            for (const p of packed.pages) {
              CaptionView.renderPage(cap, words, p, {
                wi: p.end,
                mode: "phrase",
                grew: false,
                found: -1,
              });
              const lines = Math.round(cap.scrollHeight / lineH);
              worstLines = Math.max(worstLines, lines);
              if (cap.scrollHeight > stage.clientHeight + 1) overflowing += 1;
            }
            return {
              worstLines,
              overflowing,
              pages: packed.pages.length,
              fontSize: getComputedStyle(cap).fontSize,
            };
          },
          stack,
          scale,
        );

        const bad = res.worstLines > 4 || res.overflowing > 0;
        if (bad) failures += 1;
        console.log(
          `${size.width}x${size.height} ${fontName}/${sizeName} @${res.fontSize}: ` +
            `${res.pages} pages, worst ${res.worstLines} lines, ` +
            `${res.overflowing} overflowing ${bad ? "<-- FAIL" : "ok"}`,
        );
      }
    }
    await page.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : "\nall combinations pass");
  process.exit(failures ? 1 : 0);
})();
