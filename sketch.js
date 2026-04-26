// ---- Constants ----
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const PIXEL = 15;
const BLUE = [0, 0, 255];
const BTN_H = 45;
const BTN_PAD = 12;
const TOOL_W = BTN_H; // tool buttons are square
const GAP = 6; // gap between canvas and button rows
const TOP_PAD = 12; // padding at the very top of the window
const SIDE_PAD = 24; // padding on the right side of the window
const BOT_PAD = 24; // padding at the bottom of the window
const FONT = "'Roboto Mono', monospace";

// ---- State ----
let frames = [];
let undoStacks = [];
let currentFrame = 0;
let activeTool = "pixel";
let colorIndex = 0; // index into PALETTE
const PALETTE = [
  [0, 0, 0], // black
  [255, 255, 255], // white
  [255, 0, 0], // red
  [0, 255, 0], // green
  [0, 0, 255], // blue
];
let eKeyDown = false;
let ePressTime = 0;
let hKeyDown = false;
let isPlaying = false;
let playElapsed = 0;
let fps = 6;
let fpsFocused = false;
let showGrid = false;
let showOnionSkin = false;
// Suppress hover highlight for one mouse-over cycle after clicking a toggle off
let gridJustToggled = false;
let onionJustToggled = false;
// Pan shifts content inside the fixed canvas. Stored in canvas-space units (multiples of PIXEL).
let panX = 0,
  panY = 0;
let rawPanX = 0,
  rawPanY = 0;
let refImages = [];
let imgOpacity = 255;
let hasImages = false;

// Computed each frame by computeLayout()
let sc = 1;
let canvasOffX = 0,
  canvasOffY = 0;

// HTML elements
let fileInput, opacitySlider, fpsOverlay, fpsInput;

// Background checkerboard (canvas resolution)
let bgGraphics = null;

// Hit areas — repopulated every frame
let hitColorBtns = [],
  hitEraseTool = null;
let hitOnion = null,
  hitPlay = null,
  hitPlus = null,
  hitExport = null;
let hitClearFrame = null,
  hitShowGrid = null,
  hitUpload = null;
let hitFPS = null;
let hitFrames = [],
  hitFrameDelete = [];

// ---- Layout ----
function computeLayout() {
  let TOOL_TOTAL = TOOL_W + GAP;
  let TOP_H = BTN_H + GAP;
  let BOT_H = BTN_H + GAP;
  sc = min(
    1,
    (windowWidth - SIDE_PAD - TOOL_TOTAL - SIDE_PAD) / CANVAS_W,
    (windowHeight - TOP_H - BOT_H - TOP_PAD - BOT_PAD) / CANVAS_H,
  );
  canvasOffX =
    SIDE_PAD + TOOL_TOTAL + floor((windowWidth - SIDE_PAD * 2 - TOOL_TOTAL - CANVAS_W * sc) / 2);
  canvasOffY = TOP_H + TOP_PAD;
}

function screenToCanvas(sx, sy) {
  return { x: (sx - canvasOffX) / sc - panX, y: (sy - canvasOffY) / sc - panY };
}

function inDrawArea(mx, my) {
  return (
    mx >= canvasOffX &&
    mx <= canvasOffX + CANVAS_W * sc &&
    my >= canvasOffY &&
    my <= canvasOffY + CANVAS_H * sc
  );
}

function hitInRect(mx, my, r) {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}

function onUI(mx, my) {
  let hits = [
    hitClearFrame,
    hitShowGrid,
    hitUpload,
    hitFPS,
    hitEraseTool,
    hitOnion,
    hitPlay,
    hitPlus,
    hitExport,
    ...hitColorBtns,
  ];
  for (let h of hits) {
    if (h && hitInRect(mx, my, h)) return true;
  }
  for (let i = 0; i < hitFrames.length; i++) {
    if (hitFrames[i] && hitInRect(mx, my, hitFrames[i])) return true;
    if (hitFrameDelete[i] && hitInRect(mx, my, hitFrameDelete[i])) return true;
  }
  return false;
}

// ---- Background checkerboard ----
function createBgGraphics() {
  if (bgGraphics) bgGraphics.remove();
  bgGraphics = createGraphics(CANVAS_W, CANVAS_H);
  bgGraphics.noSmooth();
  bgGraphics.noStroke();
  for (let y = 0; y < CANVAS_H; y += PIXEL) {
    for (let x = 0; x < CANVAS_W; x += PIXEL) {
      bgGraphics.fill(
        (floor(x / PIXEL) + floor(y / PIXEL)) % 2 === 0 ? 255 : 220,
      );
      bgGraphics.rect(x, y, PIXEL, PIXEL);
    }
  }
}

// ---- Frame factory ----
function newFrame() {
  let g = createGraphics(CANVAS_W, CANVAS_H);
  g.noSmooth();
  return g;
}

// ---- Setup ----
function setup() {
  let cnv = createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  noSmooth();
  noCursor();
  cnv.elt.addEventListener("contextmenu", (e) => e.preventDefault());

  cnv.elt.addEventListener("dragover", (e) => e.preventDefault());
  cnv.elt.addEventListener("drop", (e) => {
    e.preventDefault();
    let f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/"))
      loadSingleRefImage(URL.createObjectURL(f));
  });
  window.addEventListener("paste", (e) => {
    if (!e.clipboardData) return;
    for (let item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        loadSingleRefImage(URL.createObjectURL(item.getAsFile()));
        break;
      }
    }
  });

  fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);
  fileInput.addEventListener("change", onFilesSelected);

  opacitySlider = document.createElement("input");
  opacitySlider.type = "range";
  opacitySlider.min = "0";
  opacitySlider.max = "100";
  opacitySlider.value = "100";
  opacitySlider.style.cssText =
    "display:none;position:absolute;z-index:10;width:120px;";
  document.body.appendChild(opacitySlider);
  opacitySlider.addEventListener("input", () => {
    imgOpacity = map(parseInt(opacitySlider.value), 0, 100, 0, 255);
  });

  // FPS overlay: always-visible flex div — never toggled on/off.
  // Being always present (like Marching Ants' fps-group) avoids text shifts on click.
  // Canvas skips drawing the FPS button; this overlay owns that slot entirely.
  fpsOverlay = document.createElement("div");
  fpsOverlay.id = "fps-overlay";
  fpsOverlay.style.cssText = [
    "position:absolute",
    "z-index:10",
    "left:-9999px",
    "background:rgb(0,0,255)",
    "border-top:1px solid transparent",
    "border-bottom:1px solid transparent",
    "border-left:1px solid #fff",
    "border-right:1px solid #fff",
    "box-sizing:border-box",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "gap:4px",
    "cursor:pointer",
  ].join(";");
  document.body.appendChild(fpsOverlay);

  fpsInput = document.createElement("input");
  fpsInput.id = "fps-input";
  fpsInput.type = "text";
  fpsInput.maxLength = 2;
  fpsInput.style.cssText = [
    "background:transparent",
    "color:#ffffff",
    "caret-color:#ffffff",
    "font-family:'Roboto Mono',monospace",
    "font-size:12px",
    "border:none",
    "outline:none",
    "padding:0",
    "margin:0",
    "width:2ch",
    "text-align:right",
    "min-width:0",
    "-webkit-appearance:none",
    "appearance:none",
  ].join(";");
  fpsOverlay.appendChild(fpsInput);

  let fpsSuffix = document.createElement("span");
  fpsSuffix.textContent = "\u2009FPS"; // thin-space + FPS to match " FPS" label spacing
  fpsSuffix.id = "fps-suffix";
  fpsSuffix.textContent = "FPS";
  // (the " FPS" line above is superseded by this assignment — JS last-write wins)
  fpsSuffix.style.cssText = [
    "color:#ffffff",
    "font-family:'Roboto Mono',monospace",
    "font-size:12px",
    "pointer-events:none",
    "user-select:none",
  ].join(";");
  fpsOverlay.appendChild(fpsSuffix);

  // Hover and focus-within styles — mirrors the Marching Ants fps-group CSS.
  const fpsStyle = document.createElement("style");
  fpsStyle.textContent = [
    "#fps-overlay:hover { background:#ffffff !important; border-top-color:rgb(0,0,255) !important; border-bottom-color:rgb(0,0,255) !important; }",
    "#fps-overlay:hover #fps-input, #fps-overlay:hover #fps-suffix { color:rgb(0,0,255) !important; caret-color:rgb(0,0,255) !important; }",
    "#fps-overlay:focus-within { background:rgb(0,0,255) !important; border-top-color:transparent !important; border-bottom-color:transparent !important; }",
    "#fps-overlay:focus-within #fps-input, #fps-overlay:focus-within #fps-suffix { color:#ffffff !important; caret-color:#ffffff !important; }",
  ].join("\n");
  document.head.appendChild(fpsStyle);

  fpsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      commitFPS();
    }
    // Only allow digits, navigation, and clipboard shortcuts
    if (
      !/^[0-9]$/.test(e.key) &&
      !["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab"].includes(
        e.key,
      ) &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      e.preventDefault();
    }
  });
  fpsInput.addEventListener("blur", commitFPS);

  window.addEventListener("keydown", _onKeyDown, true);
  window.addEventListener("keyup", _onKeyUp, true);

  computeLayout();
  createBgGraphics();

  let g = newFrame();
  frames.push(g);
  undoStacks.push([g.get()]);
}

// ---- FPS commit ----
function commitFPS() {
  let v = parseInt(fpsInput.value);
  if (!isNaN(v) && v >= 1 && v <= 24) fps = v;
  fpsFocused = false;
}

// ---- Image loading ----
function loadSingleRefImage(url) {
  loadImage(url, (img) => {
    refImages = [img];
    hasImages = true;
    imgOpacity = 255;
    opacitySlider.value = "100";
  });
}

function onFilesSelected() {
  let files = fileInput.files;
  if (!files || !files.length) return;
  let count = files.length,
    imgs = new Array(count),
    loaded = 0;
  for (let i = 0; i < count; i++) {
    ((idx) =>
      loadImage(URL.createObjectURL(files[idx]), (img) => {
        imgs[idx] = img;
        if (++loaded === count) {
          refImages = imgs;
          hasImages = true;
          imgOpacity = 255;
          opacitySlider.value = "100";
          let need = min(count, 24);
          while (frames.length < need) {
            let g = newFrame();
            frames.push(g);
            undoStacks.push([g.get()]);
          }
        }
      }))(i);
  }
  fileInput.value = "";
}

// ---- Keyboard ----
// window capture-phase listeners are the most reliable way to intercept special
// keys (Backspace, Arrow, Space) regardless of p5.js version or canvas focus state.
// The HTML FPS input has its own keydown listener; we bail immediately when
// fpsFocused so the two handlers never interfere.
function _onKeyDown(e) {
  if (fpsFocused) return;

  // Suppress browser defaults for keys we handle
  if (["ArrowLeft", "ArrowRight", "Backspace", " "].includes(e.key))
    e.preventDefault();

  // Undo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    let stack = undoStacks[currentFrame];
    if (stack.length > 1) {
      stack.pop();
      frames[currentFrame].clear();
      frames[currentFrame].image(stack[stack.length - 1], 0, 0);
    }
    return;
  }

  // Duplicate frame
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicateFrame(currentFrame);
    return;
  }

  switch (e.key) {
    case "Backspace":
      if (frames.length > 1) {
        deleteFrame(currentFrame);
      } else {
        frames[0].clear();
        pushUndo();
        refImages = [];
        hasImages = false;
      }
      break;
    case "ArrowLeft":
    case "a":
    case "A":
      currentFrame = (currentFrame - 1 + frames.length) % frames.length;
      break;
    case "ArrowRight":
    case "d":
    case "D":
      currentFrame = (currentFrame + 1) % frames.length;
      break;
    case " ":
      isPlaying = !isPlaying;
      playElapsed = 0;
      break;
    case "g":
    case "G":
      showGrid = !showGrid;
      break;
    case "o":
    case "O":
      showOnionSkin = !showOnionSkin;
      break;
    case "x":
    case "X":
      if (!e.ctrlKey && !e.metaKey) {
        frames[currentFrame].clear();
        pushUndo();
      }
      break;
    case "+":
    case "=":
    case "f":
    case "F":
      addFrame();
      break;
    case "1": case "2": case "3": case "4": case "5":
      activeTool = "pixel";
      colorIndex = parseInt(e.key) - 1;
      break;
    case "e":
    case "E":
      if (!eKeyDown) {
        eKeyDown = true;
        ePressTime = millis();
      }
      break;
    case "h":
    case "H":
      hKeyDown = true;
      break;
  }
}

// Commit the current pan into every frame's pixels, then reset pan to zero.
// Whatever slid off the canvas edge is clipped — content stays where it visually was.
// After baking, drawing always works across the full 1920×1080 area.
function bakePan() {
  if (panX === 0 && panY === 0) return;
  for (let i = 0; i < frames.length; i++) {
    let g = frames[i];
    let tmp = createGraphics(CANVAS_W, CANVAS_H);
    tmp.noSmooth();
    tmp.image(g, panX, panY);
    g.clear();
    g.image(tmp, 0, 0);
    tmp.remove();
    undoStacks[i].push(g.get());
    if (undoStacks[i].length > 25) undoStacks[i].shift();
  }
  panX = 0;
  panY = 0;
  rawPanX = 0;
  rawPanY = 0;
}

function _onKeyUp(e) {
  if (e.key === "e" || e.key === "E") {
    if (millis() - ePressTime < 250) activeTool = "erase"; // tap → switch permanently
    eKeyDown = false;
  }
  if (e.key === "h" || e.key === "H") {
    hKeyDown = false;
    bakePan();
  }
}

// ---- Frame management ----
function addFrame() {
  if (frames.length >= 24) return;
  let g = newFrame();
  frames.push(g);
  undoStacks.push([g.get()]);
  currentFrame = frames.length - 1;
}
function deleteFrame(i) {
  if (frames.length <= 1) return;
  frames[i].remove();
  frames.splice(i, 1);
  undoStacks.splice(i, 1);
  if (i < refImages.length) {
    refImages.splice(i, 1);
    if (refImages.length === 0) hasImages = false;
  }
  currentFrame = min(currentFrame, frames.length - 1);
}
function duplicateFrame(i) {
  if (frames.length >= 24) return;
  let src = frames[i];
  let g = newFrame();
  g.image(src, 0, 0);
  frames.splice(i + 1, 0, g);
  undoStacks.splice(i + 1, 0, [g.get()]);
  // Duplicate the ref image for this frame too, if one exists
  if (i < refImages.length) {
    refImages.splice(i + 1, 0, refImages[i]);
  }
  currentFrame = i + 1;
}
function pushUndo() {
  let stack = undoStacks[currentFrame];
  stack.push(frames[currentFrame].get());
  if (stack.length > 25) stack.shift();
}

// ---- Button drawing ----
// skip = { left: bool, right: bool, top: bool }
// The rule that gives exactly 1 px at every active-to-active junction:
//   • Always draw the right edge (bottom edge for vertical stacks).
//   • Suppress the left edge (top edge) when the neighbour on that side is also on.
// The neighbour therefore never needs to suppress its own right/bottom edge.
//   • Suppress the right edge only when an HTML overlay owns that shared edge.
function drawBtn(x, y, w, h, active, hovered, drawContent, skip) {
  let on = active || hovered;
  noStroke();
  fill(on ? 255 : color(...BLUE));
  rect(x, y, w, h);
  if (on) {
    noFill();
    stroke(...BLUE);
    strokeWeight(1);
    let lx = floor(x) + 0.5;
    let rx = floor(x + w) - 0.5;
    let ty2 = floor(y) + 0.5;
    let by2 = floor(y + h) - 0.5;
    if (!skip?.top) line(lx, ty2, rx, ty2); // top  (skip when vertical neighbour above is on)
    line(lx, by2, rx, by2); // bottom — always draw
    if (!skip?.left) line(lx, ty2, lx, by2); // left  (skip when horizontal neighbour left is on)
    if (!skip?.right) line(rx, ty2, rx, by2); // right — usually always drawn
    noStroke();
  }
  if (drawContent) drawContent(on);
}

function textBtn(x, y, w, h, label, active, hovered, skip) {
  drawBtn(
    x,
    y,
    w,
    h,
    active,
    hovered,
    (on) => {
      fill(on ? color(...BLUE) : 255);
      noStroke();
      textFont(FONT);
      textSize(12);
      textAlign(CENTER, CENTER);
      text(label, x + w / 2, y + h / 2);
    },
    skip,
  );
}

// White 1 px dividers between adjacent non-active, non-hovered buttons.
// Integer-snapped (+0.5) for crisp pixel-centre rendering.
// skipRefs: button refs whose adjacencies are owned by an HTML overlay.
function drawDividers(btns, vertical, skipRefs = []) {
  stroke(255);
  strokeWeight(1);
  noFill();
  for (let i = 0; i < btns.length - 1; i++) {
    let a = btns[i],
      b = btns[i + 1];
    if (skipRefs.includes(a.ref) || skipRefs.includes(b.ref)) continue;
    if (a.active || a.hov || b.active || b.hov) continue;
    if (vertical) {
      let divY = floor(a.y + BTN_H) + 0.5;
      line(floor(a.x) + 0.5, divY, floor(a.x + a.w) - 0.5, divY);
    } else {
      let divX = floor(a.x + a.w) + 0.5;
      line(divX, floor(a.y) + 0.5, divX, floor(a.y + BTN_H) - 0.5);
    }
  }
  noStroke();
}

// ---- Main draw loop ----
function draw() {
  computeLayout();

  if (isPlaying) {
    playElapsed += deltaTime;
    if (playElapsed >= 1000 / fps) {
      currentFrame = (currentFrame + 1) % frames.length;
      playElapsed -= 1000 / fps;
    }
  }

  background(255);

  // Clip all canvas content to the canvas rectangle so panned strokes
  // don't bleed through the blue border into the UI.
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(canvasOffX, canvasOffY, CANVAS_W * sc, CANVAS_H * sc);
  drawingContext.clip();

  noSmooth();
  push();
  translate(canvasOffX, canvasOffY);
  scale(sc);

  if (showGrid) {
    image(bgGraphics, 0, 0);
  } else {
    noStroke();
    fill(255);
    rect(0, 0, CANVAS_W, CANVAS_H);
  }

  if (hasImages && refImages.length > 0) {
    let img = refImages[min(currentFrame, refImages.length - 1)];
    if (img) {
      tint(255, imgOpacity);
      image(img, (CANVAS_W - img.width) / 2, (CANVAS_H - img.height) / 2);
      noTint();
    }
  }

  if (!isPlaying && showOnionSkin && currentFrame > 0) {
    push();
    translate(panX, panY);
    tint(255, 64);
    image(frames[currentFrame - 1], 0, 0);
    noTint();
    pop();
  }

  push();
  translate(panX, panY);
  image(frames[currentFrame], 0, 0);
  pop();
  pop();

  drawingContext.restore();

  // Canvas border
  noFill();
  stroke(...BLUE);
  strokeWeight(1);
  rect(canvasOffX, canvasOffY, CANVAS_W * sc, CANVAS_H * sc);
  noStroke();

  placePixel();
  drawTopBar();
  drawToolStrip();
  drawBottomBar();
  drawCursor();
}

// ---- Pixel drawing ----
function placePixel() {
  if (!mouseIsPressed || isPlaying || hKeyDown) return;
  if (onUI(mouseX, mouseY) || !inDrawArea(mouseX, mouseY)) return;

  let g = frames[currentFrame];
  let cur = screenToCanvas(mouseX, mouseY),
    prv = screenToCanvas(pmouseX, pmouseY);
  let x1 = floor(cur.x / PIXEL) * PIXEL,
    y1 = floor(cur.y / PIXEL) * PIXEL;
  let x2 = floor(prv.x / PIXEL) * PIXEL,
    y2 = floor(prv.y / PIXEL) * PIXEL;
  let steps = max(abs(x1 - x2), abs(y1 - y2)) / PIXEL;
  let erasing = activeTool === "erase" || eKeyDown;
  g.noStroke();
  for (let i = 0; i <= steps; i++) {
    let t = steps === 0 ? 0 : i / steps;
    let xt = round(lerp(x1, x2, t) / PIXEL) * PIXEL,
      yt = round(lerp(y1, y2, t) / PIXEL) * PIXEL;
    if (erasing) {
      g.erase();
      g.rect(xt, yt, PIXEL, PIXEL);
      g.noErase();
    } else {
      g.fill(...PALETTE[colorIndex]);
      g.rect(xt, yt, PIXEL, PIXEL);
    }
  }
}

// ---- Top bar ----
function drawTopBar() {
  textFont(FONT);
  textSize(12);
  let ty = canvasOffY - BTN_H - GAP;

  let uploadLabel = hasImages ? "Remove IMG" : "Upload IMG";
  let uploadW = ceil(
    max(textWidth("Upload IMG"), textWidth("Remove IMG")) + BTN_PAD * 2,
  );

  let btns = [
    {
      label: "Clear Frame",
      w: ceil(textWidth("Clear Frame") + BTN_PAD * 2),
      active: false,
      ref: "clear",
    },
    {
      label: "Show Grid",
      w: ceil(textWidth("Show Grid") + BTN_PAD * 2),
      active: showGrid,
      ref: "grid",
    },
    { label: uploadLabel, w: uploadW, active: false, ref: "upload" },
  ];

  let x = canvasOffX;
  for (let b of btns) {
    b.x = x;
    b.y = ty;
    x += b.w;
  }
  for (let b of btns) {
    let inBounds =
      mouseX >= b.x &&
      mouseX <= b.x + b.w &&
      mouseY >= ty &&
      mouseY <= ty + BTN_H;
    if (b.ref === "grid") {
      if (!inBounds) gridJustToggled = false;
      b.hov = inBounds && !gridJustToggled;
    } else {
      b.hov = inBounds;
    }
  }

  hitClearFrame = { x: btns[0].x, y: ty, w: btns[0].w, h: BTN_H };
  hitShowGrid = { x: btns[1].x, y: ty, w: btns[1].w, h: BTN_H };
  hitUpload = { x: btns[2].x, y: ty, w: btns[2].w, h: BTN_H };

  for (let i = 0; i < btns.length; i++) {
    let b = btns[i];
    let on = b.active || b.hov;
    let leftOn = i > 0 && (btns[i - 1].active || btns[i - 1].hov);
    textBtn(b.x, b.y, b.w, BTN_H, b.label, b.active, b.hov && !b.active, {
      left: on && leftOn,
    });
  }
  drawDividers(btns, false);

  // ---- Opacity control ----
  // Flush to the last button, separated by a 1 px white divider.
  // BTN_PAD on both sides; extra thumb clearance (+8) on the right.
  if (hasImages) {
    textFont(FONT);
    textSize(12);
    let labelText = "Opacity";
    let sliderW = 120;
    let labelW = ceil(textWidth(labelText));
    let rightPad = BTN_PAD + 8; // extra clearance for slider thumb
    let areaW = BTN_PAD + labelW + 8 + sliderW + rightPad;
    let lastBtn = btns[btns.length - 1];
    let lastOn = lastBtn.active || lastBtn.hov;

    // Blue background
    noStroke();
    fill(...BLUE);
    rect(x, ty, areaW, BTN_H);

    // 1 px white divider — only when the adjacent button is NOT active/hovered
    // (when it is active/hovered its own right-side blue border already serves as separator)
    if (!lastOn) {
      stroke(255);
      strokeWeight(1);
      line(
        floor(x) + 0.5,
        floor(ty) + 0.5,
        floor(x) + 0.5,
        floor(ty + BTN_H) - 0.5,
      );
      noStroke();
    }

    // White "Opacity" label
    textAlign(LEFT, CENTER);
    fill(255);
    noStroke();
    text(labelText, x + BTN_PAD, ty + BTN_H / 2);

    // HTML slider
    let sliderX = x + BTN_PAD + labelW + 8;
    let thumbR = 5;
    let sliderTop = ty + BTN_H / 2 - thumbR;
    opacitySlider.style.display = "block";
    opacitySlider.style.left = sliderX + "px";
    opacitySlider.style.top = sliderTop + "px";
    opacitySlider.style.height = thumbR * 2 + "px";
    textAlign(CENTER, CENTER);
  } else {
    opacitySlider.style.display = "none";
  }
}

// ---- Tool strip ----
function drawToolStrip() {
  let tx = canvasOffX - TOOL_W - GAP;
  let y0 = canvasOffY;

  // Build state for all tool buttons (5 colours + eraser)
  hitColorBtns = [];
  let toolBtns = [];

  for (let i = 0; i < PALETTE.length; i++) {
    let by = y0 + i * TOOL_W;
    let sel = activeTool === "pixel" && colorIndex === i;
    let hov =
      !sel &&
      mouseX >= tx &&
      mouseX <= tx + TOOL_W &&
      mouseY >= by &&
      mouseY <= by + TOOL_W;
    toolBtns.push({ y: by, active: sel, hov });
    hitColorBtns[i] = { x: tx, y: by, w: TOOL_W, h: TOOL_W };
  }

  let ey = y0 + PALETTE.length * TOOL_W;
  let es = activeTool === "erase";
  let eh =
    !es &&
    mouseX >= tx &&
    mouseX <= tx + TOOL_W &&
    mouseY >= ey &&
    mouseY <= ey + TOOL_W;
  toolBtns.push({ y: ey, active: es, hov: eh });
  hitEraseTool = { x: tx, y: ey, w: TOOL_W, h: TOOL_W };

  // Draw colour swatch buttons
  for (let i = 0; i < PALETTE.length; i++) {
    let b = toolBtns[i];
    let col = PALETTE[i];
    let prevOn = i > 0 && (toolBtns[i - 1].active || toolBtns[i - 1].hov);
    let on = b.active || b.hov;
    let isBlue = col[0] === 0 && col[1] === 0 && col[2] === 255;
    let isWhite = col[0] === 255 && col[1] === 255 && col[2] === 255;

    drawBtn(
      tx,
      b.y,
      TOOL_W,
      TOOL_W,
      b.active,
      b.hov,
      (on2) => {
        let s = PIXEL,
          cx2 = tx + TOOL_W / 2,
          cy2 = b.y + TOOL_W / 2;
        if (isBlue && !on2) {
          // Blue square on blue bg → white outline drawn inset so it stays within s×s
          noFill();
          stroke(255);
          strokeWeight(1);
          rect(
            floor(cx2 - s / 2) + 0.5,
            floor(cy2 - s / 2) + 0.5,
            s - 1,
            s - 1,
          );
          noStroke();
        } else if (isWhite && on2) {
          // White square on white bg → blue outline so it's visible
          fill(255);
          noStroke();
          rect(cx2 - s / 2, cy2 - s / 2, s, s);
          noFill();
          stroke(...BLUE);
          strokeWeight(1);
          rect(
            floor(cx2 - s / 2) + 0.5,
            floor(cy2 - s / 2) + 0.5,
            s - 1,
            s - 1,
          );
          noStroke();
        } else {
          fill(...col);
          noStroke();
          rect(cx2 - s / 2, cy2 - s / 2, s, s);
        }
      },
      { top: on && prevOn },
    );
  }

  // Draw eraser button
  let eb = toolBtns[PALETTE.length];
  let prevOn =
    toolBtns[PALETTE.length - 1].active || toolBtns[PALETTE.length - 1].hov;
  let on = eb.active || eb.hov;
  drawBtn(
    tx,
    ey,
    TOOL_W,
    TOOL_W,
    es,
    eh,
    (on2) => {
      stroke(on2 ? color(...BLUE) : 255);
      strokeWeight(2);
      let s = round(PIXEL * sc),
        cx2 = tx + TOOL_W / 2,
        cy2 = ey + TOOL_W / 2;
      line(cx2 - s / 2 + 1, cy2 - s / 2 + 1, cx2 + s / 2 - 1, cy2 + s / 2 - 1);
      line(cx2 + s / 2 - 1, cy2 - s / 2 + 1, cx2 - s / 2 + 1, cy2 + s / 2 - 1);
      noStroke();
    },
    { top: on && prevOn },
  );

  // White 1px horizontal dividers drawn last so they appear on top of button fills
  stroke(255);
  strokeWeight(1);
  noFill();
  for (let i = 0; i < toolBtns.length - 1; i++) {
    let a = toolBtns[i],
      b = toolBtns[i + 1];
    if (a.active || a.hov || b.active || b.hov) continue;
    let divY = floor(a.y + TOOL_W) + 0.5;
    line(floor(tx) + 0.5, divY, floor(tx + TOOL_W) - 0.5, divY);
  }
  noStroke();
}

// ---- Bottom bar ----
function drawBottomBar() {
  textFont(FONT);
  textSize(12);
  let by = floor(canvasOffY + CANVAS_H * sc + GAP);

  let btns = [];
  btns.push({
    label: "Onion Skinning",
    w: ceil(textWidth("Onion Skinning") + BTN_PAD * 2),
    active: showOnionSkin,
    ref: "onion",
  });
  // FPS button width tracks the live input value while typing so the button resizes in real time.
  let fpsDisplayVal = (fpsFocused && fpsInput.value) ? fpsInput.value : str(fps);
  btns.push({
    label: fpsDisplayVal + " FPS",
    w: ceil(textWidth(fpsDisplayVal + " FPS") + BTN_PAD * 2),
    active: false,
    ref: "fps",
  });
  btns.push({ label: "", w: BTN_H, active: false, ref: "play" });
  for (let i = 0; i < frames.length; i++)
    btns.push({
      label: str(i + 1),
      w: BTN_H,
      active: i === currentFrame,
      ref: "frame_" + i,
    });
  btns.push({ label: "+", w: BTN_H, active: false, ref: "plus" });
  btns.push({
    label: "Export",
    w: ceil(textWidth("Export") + BTN_PAD * 2),
    active: false,
    ref: "export",
  });

  let x = canvasOffX;
  for (let b of btns) {
    b.x = x;
    b.y = by;
    x += b.w;
  }
  for (let b of btns) {
    let inBounds =
      mouseX >= b.x &&
      mouseX <= b.x + b.w &&
      mouseY >= by &&
      mouseY <= by + BTN_H;
    if (b.ref === "onion") {
      if (!inBounds) onionJustToggled = false;
      b.hov = inBounds && !onionJustToggled;
    } else {
      b.hov = inBounds;
    }
  }

  hitOnion = null;
  hitPlay = null;
  hitPlus = null;
  hitExport = null;
  hitFPS = null;
  hitFrames = new Array(frames.length).fill(null);
  hitFrameDelete = new Array(frames.length).fill(null);

  for (let b of btns) {
    if (b.ref === "onion") hitOnion = { x: b.x, y: by, w: b.w, h: BTN_H };
    if (b.ref === "fps") {
      hitFPS = { x: b.x, y: by, w: b.w, h: BTN_H };
      fpsOverlay.style.left = hitFPS.x + "px";
      fpsOverlay.style.top = hitFPS.y + "px";
      fpsOverlay.style.width = hitFPS.w + "px";
      fpsOverlay.style.height = hitFPS.h + "px";
      if (!fpsFocused) fpsInput.value = str(fps);
      fpsInput.style.width = Math.max(1, fpsInput.value.length) + "ch";
      // Set border colors each frame to avoid double-border with canvas-drawn neighbor borders.
      // Border-color is NOT set via CSS (no !important), so JS inline wins.
      let fpsIdx = btns.indexOf(b);
      let leftNeighbor = fpsIdx > 0 ? btns[fpsIdx - 1] : null;
      let rightNeighbor = fpsIdx < btns.length - 1 ? btns[fpsIdx + 1] : null;
      let leftOn = leftNeighbor && (leftNeighbor.active || leftNeighbor.hov);
      let rightOn = rightNeighbor && (rightNeighbor.hov);
      let fpsHov = b.hov && !fpsFocused; // when focused, :focus-within wins over :hover → keep borders white
      fpsOverlay.style.borderLeftColor  = (fpsHov || leftOn)  ? "rgb(0,0,255)" : "#fff";
      fpsOverlay.style.borderRightColor = (fpsHov || rightOn) ? "rgb(0,0,255)" : "#fff";
    }
    if (b.ref === "play") hitPlay = { x: b.x, y: by, w: b.w, h: BTN_H };
    if (b.ref === "plus") hitPlus = { x: b.x, y: by, w: b.w, h: BTN_H };
    if (b.ref === "export") hitExport = { x: b.x, y: by, w: b.w, h: BTN_H };
    if (b.ref.startsWith("frame_")) {
      let fi = parseInt(b.ref.split("_")[1]);
      hitFrames[fi] = { x: b.x, y: by, w: b.w, h: BTN_H };
      if (frames.length > 1)
        hitFrameDelete[fi] = { x: b.x + b.w - 14, y: by + 4, w: 12, h: 12 };
    }
  }

  for (let i = 0; i < btns.length; i++) {
    let b = btns[i];
    if (b.ref === "fps") continue; // overlay handles this slot entirely

    let on = b.active || b.hov;
    let leftOn = i > 0 && (btns[i - 1].active || btns[i - 1].hov);
    let rightOwnedByFPS = i < btns.length - 1 && btns[i + 1].ref === "fps";

    if (b.ref === "play") {
      drawBtn(
        b.x,
        b.y,
        b.w,
        BTN_H,
        false,
        b.hov,
        (on2) => {
          fill(on2 ? color(...BLUE) : 255);
          noStroke();
          if (isPlaying) {
            // Pause icon — exact geometry from pause.svg
            rect(b.x + 14, b.y + 12.5, 6, 20);
            rect(b.x + 24, b.y + 12.5, 6, 20);
          } else {
            // Play icon — exact geometry from play.svg
            triangle(
              b.x + 14,
              b.y + 12.1077,
              b.x + 14,
              b.y + 32.8923,
              b.x + 32,
              b.y + 22.5,
            );
          }
        },
        { left: on && leftOn, right: on && rightOwnedByFPS },
      );
    } else {
      textBtn(b.x, b.y, b.w, BTN_H, b.label, b.active, b.hov && !b.active, {
        left: on && leftOn,
        right: on && rightOwnedByFPS,
      });
    }
  }

  drawDividers(btns, false, ["fps"]);

  // Frame delete × — inside top-right corner of the frame button, shown on hover
  for (let i = 0; i < frames.length; i++) {
    if (!hitFrames[i]) continue;
    let fb = hitFrames[i];
    let zoneHov =
      mouseX >= fb.x &&
      mouseX <= fb.x + fb.w &&
      mouseY >= by &&
      mouseY <= by + BTN_H;
    if (frames.length > 1 && zoneHov) {
      noStroke();
      fill(...BLUE);
      textFont(FONT);
      textSize(9);
      textAlign(RIGHT, TOP);
      text("×", fb.x + fb.w - 4, by + 4);
    }
  }
}

// ---- Cursor ----
function drawCursor() {
  if (onUI(mouseX, mouseY) || !inDrawArea(mouseX, mouseY)) {
    cursor(ARROW);
    return;
  }
  noCursor();

  let c = screenToCanvas(mouseX, mouseY);
  let snapCX = floor(c.x / PIXEL) * PIXEL,
    snapCY = floor(c.y / PIXEL) * PIXEL;
  let sx = canvasOffX + (snapCX + panX) * sc,
    sy = canvasOffY + (snapCY + panY) * sc;
  let ps = PIXEL * sc;

  let erasing = activeTool === "erase" || eKeyDown;
  if (erasing) {
    let px = frames[currentFrame].get(snapCX, snapCY);
    stroke(px[3] > 0 ? 255 : 0);
    strokeWeight(2);
    line(sx + 1, sy + 1, sx + ps - 1, sy + ps - 1);
    line(sx + ps - 1, sy + 1, sx + 1, sy + ps - 1);
    noStroke();
  } else {
    fill(...PALETTE[colorIndex]);
    noStroke();
    rect(sx, sy, ps, ps);
  }
}

// ---- Mouse ----
function mousePressed() {
  // Clicking anywhere except the FPS input area commits any active FPS edit.
  if (fpsFocused && !(hitFPS && hitInRect(mouseX, mouseY, hitFPS))) commitFPS();

  if (hitClearFrame && hitInRect(mouseX, mouseY, hitClearFrame)) {
    frames[currentFrame].clear();
    pushUndo();
    return false;
  }
  if (hitShowGrid && hitInRect(mouseX, mouseY, hitShowGrid)) {
    if (showGrid) gridJustToggled = true;
    showGrid = !showGrid;
    return false;
  }
  if (hitUpload && hitInRect(mouseX, mouseY, hitUpload)) {
    if (hasImages) {
      refImages = [];
      hasImages = false;
    } else {
      fileInput.click();
    }
    return false;
  }
  for (let i = 0; i < hitColorBtns.length; i++) {
    if (hitColorBtns[i] && hitInRect(mouseX, mouseY, hitColorBtns[i])) {
      activeTool = "pixel";
      colorIndex = i;
      return false;
    }
  }
  if (hitEraseTool && hitInRect(mouseX, mouseY, hitEraseTool)) {
    activeTool = "erase";
    return false;
  }

  for (let i = 0; i < hitFrameDelete.length; i++) {
    if (hitFrameDelete[i] && hitInRect(mouseX, mouseY, hitFrameDelete[i])) {
      deleteFrame(i);
      return false;
    }
  }

  if (hitFPS && hitInRect(mouseX, mouseY, hitFPS)) {
    fpsFocused = true;
    fpsInput.value = str(fps);
    // Defer focus so p5's mousePressed return value doesn't steal it back.
    setTimeout(() => { fpsInput.focus(); fpsInput.select(); }, 0);
    return false;
  }
  if (hitOnion && hitInRect(mouseX, mouseY, hitOnion)) {
    if (showOnionSkin) onionJustToggled = true;
    showOnionSkin = !showOnionSkin;
    return false;
  }
  if (hitPlay && hitInRect(mouseX, mouseY, hitPlay)) {
    isPlaying = !isPlaying;
    playElapsed = 0;
    return false;
  }
  if (hitPlus && hitInRect(mouseX, mouseY, hitPlus)) {
    addFrame();
    return false;
  }
  if (hitExport && hitInRect(mouseX, mouseY, hitExport)) {
    exportFrames();
    return false;
  }

  for (let i = 0; i < hitFrames.length; i++) {
    if (hitFrames[i] && hitInRect(mouseX, mouseY, hitFrames[i])) {
      currentFrame = i;
      return false;
    }
  }
}

function mouseReleased() {
  if (!onUI(pmouseX, pmouseY) && inDrawArea(pmouseX, pmouseY)) pushUndo();
}

function _applyPan() {
  rawPanX += (mouseX - pmouseX) / sc;
  rawPanY += (mouseY - pmouseY) / sc;
  panX = round(rawPanX / PIXEL) * PIXEL;
  panY = round(rawPanY / PIXEL) * PIXEL;
}

// Pan works whether or not a mouse button is held.
function mouseMoved() {
  if (hKeyDown) {
    _applyPan();
    return false;
  }
}
function mouseDragged() {
  if (hKeyDown) {
    _applyPan();
    return false;
  }
}

// ---- Export ----
async function exportFrames() {
  isPlaying = false;
  let zip = new JSZip();
  for (let i = 0; i < frames.length; i++) {
    let tmp = createGraphics(CANVAS_W, CANVAS_H);
    tmp.noSmooth();
    tmp.push();
    tmp.translate(panX, panY);
    tmp.image(frames[i], 0, 0);
    tmp.pop();
    zip.file(
      "frame-" + String(i + 1).padStart(3, "0") + ".png",
      tmp.elt.toDataURL("image/png").split(",")[1],
      { base64: true },
    );
    tmp.remove();
  }
  let blob = await zip.generateAsync({ type: "blob" });
  let a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pixelart-export.zip";
  a.click();
}

// ---- Window resize ----
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  computeLayout();
}
