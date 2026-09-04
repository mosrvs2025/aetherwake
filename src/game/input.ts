const codes = new Set<string>();
const downs = new Set<string>();

export const input = {
  mx: 0,
  my: 0,
  attack: false,
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
    if (codes.has("KeyA") || codes.has("ArrowLeft")) x -= 1;
    if (codes.has("KeyD") || codes.has("ArrowRight")) x += 1;
    if (codes.has("KeyW") || codes.has("ArrowUp")) y -= 1;
    if (codes.has("KeyS") || codes.has("ArrowDown")) y += 1;
    return { x, y };
  },
};

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat) return;
  if (["Space", "Tab"].includes(e.code)) e.preventDefault();
  codes.add(e.code);
  downs.add(e.code);
}

function onKeyUp(e: KeyboardEvent) {
  codes.delete(e.code);
}

function onMouseDown(e: MouseEvent) {
  if (e.button === 0) input.attack = true;
}

function onMouseMove(e: MouseEvent) {
  input.mx += e.movementX;
  input.my += e.movementY;
}

export function bindInput() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mousemove", onMouseMove);
  };
}

export function consumeLook() {
  const x = input.mx;
  const y = input.my;
  input.mx = 0;
  input.my = 0;
  return { x, y };
}
