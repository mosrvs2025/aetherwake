const codes = new Set<string>();
const downs = new Set<string>();

export const input = {
  mx: 0,
  my: 0,
  attack: false,
  dragging: false,
  consumeAttack() {
    const a = input.attack;
    input.attack = false;
    return a;
  },
  pressed(code: string) {
    return codes.has(code);
  },
  just(code: string) {
    if (downs.has(code)) {
      downs.delete(code);
      return true;
    }
    return false;
  },
  axis() {
    let x = 0;
    let y = 0;
    if (codes.has("KeyA")) x -= 1;
    if (codes.has("KeyD")) x += 1;
    if (codes.has("KeyW") || codes.has("ArrowUp")) y -= 1;
    if (codes.has("KeyS") || codes.has("ArrowDown")) y += 1;
    return { x, y };
  },
};

function isGameTarget(t: EventTarget | null) {
  if (!(t instanceof Element)) return true;
  if (t.closest("button, a, input, textarea, [data-ui]")) return false;
  return true;
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat) return;
  if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
    e.preventDefault();
  }
  codes.add(e.code);
  downs.add(e.code);
}

function onKeyUp(e: KeyboardEvent) {
  codes.delete(e.code);
}

function onMouseDown(e: MouseEvent) {
  if (!isGameTarget(e.target)) return;
  if (e.button === 0) {
    input.dragging = true;
    input.attack = true;
  }
  if (e.button === 2) input.dragging = true;
}

function onMouseUp() {
  input.dragging = false;
}

function onMouseMove(e: MouseEvent) {
  if (document.pointerLockElement || input.dragging) {
    input.mx += e.movementX;
    input.my += e.movementY;
  }
}

function onContext(e: MouseEvent) {
  if (isGameTarget(e.target)) e.preventDefault();
}

export function bindInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("contextmenu", onContext);
  window.addEventListener("blur", () => {
    codes.clear();
    input.dragging = false;
  });
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("contextmenu", onContext);
  };
}

export function consumeLook() {
  const x = input.mx;
  const y = input.my;
  input.mx = 0;
  input.my = 0;
  return { x, y };
}
