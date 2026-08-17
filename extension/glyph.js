// The mark for Caption Mode, shared by both entry points.
//
// Four ragged lines of text, because the feature is about reading a video, not
// about whether captions exist. YouTube's own CC control is a filled rectangle
// with letters cut out, and an icon that resembles it reads as "captions
// available" and disappears among YouTube's own controls.
//
// Its own file because the toolbar button and the feed icon load as separate
// content scripts, and a copy in each would drift.

// eslint-disable-next-line no-unused-vars
const CaptionGlyph = (() => {
  // Widths are uneven on purpose: even lines read as a list or a menu, ragged
  // ones read as prose.
  const LINES = [
    { y: 5, w: 16 },
    { y: 9.5, w: 11 },
    { y: 14, w: 16 },
    { y: 18.5, w: 7 },
  ];

  function svg(className) {
    const rects = LINES.map(
      (l) => `<rect x="4" y="${l.y}" width="${l.w}" height="2" rx="1"/>`,
    ).join("");
    return (
      `<svg${className ? ` class="${className}"` : ""} viewBox="0 0 24 24" ` +
      `aria-hidden="true">${rects}</svg>`
    );
  }

  return { svg };
})();
