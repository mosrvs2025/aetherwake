/**
 * REALMS — input. Keyboard + mouse (pointer-lock optional) + gamepad + touch.
 *
 * The game reads an immutable-ish snapshot each frame rather than listening to
 * events directly, so gameplay code never has to think about event ordering.
 */

export interface InputFrame {
  /** Movement intent in camera space, length <= 1. */
  moveX: number;
  moveZ: number;
  /** Accumulated look delta for this frame, in radians. */
  lookYaw: number;
  lookPitch: number;
  zoom: number;
  sprint: boolean;
  jump: boolean;        // edge
  dodge: boolean;       // edge
  attack: boolean;      // edge
  heavy: boolean;       // edge
  interact: boolean;    // edge
  ability1: boolean;    // edge
  ability2: boolean;    // edge
  ability3: boolean;    // edge
  lockOn: boolean;      // edge
  map: boolean;         // edge
  journal: boolean;     // edge
  pause: boolean;       // edge
  anyKey: boolean;
}

/** Radius of the virtual stick, in CSS pixels. Shared with its HUD drawing. */
export const STICK_R = 58;
/** Travel below this is a thumb resting, not a thumb steering. */
export const STICK_DEAD = 6;

/**
 * Live state of the on-screen stick, written by the input layer and read by
 * the HUD's render loop. It lives outside React on purpose: the stick moves
 * every frame a thumb is down, and pushing that through component state would
 * re-render the whole HUD sixty times a second to move one circle.
 */
export const touchStick = {
  enabled: false,
  active: false,
  /** Where the thumb first landed, in client coordinates. */
  ox: 0, oy: 0,
  /** Offset from that origin, already clamped to STICK_R. */
  dx: 0, dy: 0,
  sprint: false,
  /** Bumped on every change so a reader can skip untouched frames. */
  version: 0,
};

const EMPTY: InputFrame = {
  moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, zoom: 0,
  sprint: false, jump: false, dodge: false, attack: false, heavy: false,
  interact: false, ability1: false, ability2: false, ability3: false,
  lockOn: false, map: false, journal: false, pause: false, anyKey: false,
};

type EdgeName = keyof Pick<InputFrame,
  'jump' | 'dodge' | 'attack' | 'heavy' | 'interact' | 'ability1' | 'ability2' | 'ability3' | 'lockOn' | 'map' | 'journal' | 'pause'>;

export class Input {
  readonly frame: InputFrame = { ...EMPTY };
  private keys = new Set<string>();
  private edges = new Set<EdgeName>();
  private dYaw = 0;
  private dPitch = 0;
  private dZoom = 0;
  private pointerDown = false;
  private mouseSensitivity = 0.0022;
  /** Thumbs are coarser than mice, and phone screens are smaller. */
  touchLookSensitivity = 0.0062;
  private el: HTMLElement;
  private disposers: Array<() => void> = [];
  private anyKeyFlag = false;

  /** Virtual stick for touch. */
  touchMove = { x: 0, y: 0, active: false };
  private touchLookId = -1;
  private touchMoveId = -1;
  private touchLookPrev = { x: 0, y: 0 };
  private touchOrigin = { x: 0, y: 0 };
  /** Two-finger pinch on the look side, for camera distance. */
  private pinch = new Map<number, { x: number; y: number }>();
  private pinchPrev = 0;
  hasTouch = false;
  /** Set by the touch HUD; consumed as edges. */
  private virtualEdges = new Set<EdgeName>();
  private virtualSprint = false;

  pointerLocked = false;
  enabled = true;

  constructor(el: HTMLElement) {
    this.el = el;
    // Decide this up front rather than on the first touch: pointer lock is
    // requested when the game starts, which on a phone is before any finger
    // has landed on the canvas.
    this.hasTouch = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    touchStick.enabled = this.hasTouch;
    this.bind();
  }

  private on<K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  private on<K extends keyof HTMLElementEventMap>(t: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  private on(t: EventTarget, type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn, opts);
    this.disposers.push(() => t.removeEventListener(type, fn, opts));
  }

  private bind() {
    this.on(window, 'keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      this.anyKeyFlag = true;
      if (!this.enabled) return;
      switch (k) {
        case 'Space': this.edges.add('jump'); e.preventDefault(); break;
        case 'ShiftLeft': case 'ShiftRight': break;
        case 'ControlLeft': case 'KeyC': this.edges.add('dodge'); break;
        case 'KeyE': case 'KeyF': this.edges.add('interact'); break;
        case 'Digit1': this.edges.add('ability1'); break;
        case 'Digit2': this.edges.add('ability2'); break;
        case 'Digit3': this.edges.add('ability3'); break;
        case 'KeyQ': this.edges.add('lockOn'); break;
        case 'KeyM': this.edges.add('map'); break;
        case 'KeyJ': case 'Tab': this.edges.add('journal'); e.preventDefault(); break;
        case 'Escape': this.edges.add('pause'); break;
      }
    });
    this.on(window, 'keyup', (e) => { this.keys.delete(e.code); });
    this.on(window, 'blur', () => { this.keys.clear(); this.pointerDown = false; this.releaseTouches(); });
    // A finger that leaves the element mid-drag — over a button, off the edge
    // of the screen, into a system gesture — never delivers pointerup to the
    // canvas, which would otherwise leave the stick stuck at full deflection.
    this.on(window, 'pointerup', (e) => { if (e.pointerType === 'touch') this.onTouchUp(e); });
    this.on(window, 'pointercancel', (e) => { if (e.pointerType === 'touch') this.onTouchUp(e); });
    this.on(document as unknown as HTMLElement, 'visibilitychange' as keyof HTMLElementEventMap, () => {
      if (document.hidden) this.releaseTouches();
    });

    this.on(this.el, 'pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') { this.onTouchDown(e); return; }
      try { this.el.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
      this.pointerDown = true;
      if (e.button === 0) this.edges.add('attack');
      if (e.button === 2) this.edges.add('heavy');
    });
    this.on(this.el, 'pointerup', (e) => {
      if (e.pointerType === 'touch') { this.onTouchUp(e); return; }
      this.pointerDown = false;
    });
    this.on(this.el, 'pointercancel', (e) => { if (e.pointerType === 'touch') this.onTouchUp(e); });
    this.on(this.el, 'pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') { this.onTouchMove(e); return; }
      if (this.pointerLocked) {
        this.dYaw -= e.movementX * this.mouseSensitivity;
        this.dPitch -= e.movementY * this.mouseSensitivity;
      } else if (this.pointerDown) {
        this.dYaw -= e.movementX * this.mouseSensitivity * 1.35;
        this.dPitch -= e.movementY * this.mouseSensitivity * 1.35;
      }
    });
    this.on(this.el, 'contextmenu', (e) => e.preventDefault());
    this.on(this.el, 'wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.dZoom += Math.sign(e.deltaY) * 0.6;
    }, { passive: false });

    this.on(document as unknown as HTMLElement, 'pointerlockchange' as keyof HTMLElementEventMap, () => {
      this.pointerLocked = document.pointerLockElement === this.el;
    });
  }

  requestPointerLock() {
    if (this.hasTouch) return;
    // Chrome returns a promise that rejects when there is no user gesture yet;
    // that is a normal outcome here (the game also plays fine unlocked).
    const r = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (r && typeof r.catch === 'function') r.catch(() => {});
  }
  exitPointerLock() {
    if (document.pointerLockElement === this.el) document.exitPointerLock?.();
  }

  /* ---------------- touch ---------------- */
  private onTouchDown(e: PointerEvent) {
    this.hasTouch = true;
    touchStick.enabled = true;
    const rect = this.el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // The stick lives wherever the left thumb lands rather than at a fixed
    // spot: a phone is held differently every time you pick it up, and a
    // thumb that has to find a painted circle is a thumb watching the circle
    // instead of the game.
    if (x < rect.width * 0.45 && this.touchMoveId < 0) {
      this.touchMoveId = e.pointerId;
      this.touchOrigin = { x: e.clientX, y: e.clientY };
      this.touchMove.active = true;
      touchStick.active = true;
      touchStick.ox = e.clientX;
      touchStick.oy = e.clientY;
      touchStick.dx = 0;
      touchStick.dy = 0;
      touchStick.sprint = false;
      touchStick.version++;
    } else {
      this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touchLookId < 0) {
        this.touchLookId = e.pointerId;
        this.touchLookPrev = { x: e.clientX, y: e.clientY };
      }
    }
  }

  private onTouchMove(e: PointerEvent) {
    if (e.pointerId === this.touchMoveId) {
      const dx = e.clientX - this.touchOrigin.x;
      const dy = e.clientY - this.touchOrigin.y;
      const len = Math.hypot(dx, dy);
      // Clamped *pixel* offset, so the drawn knob and the movement read agree
      // on units. A dead zone keeps a resting thumb from creeping.
      const eff = len < STICK_DEAD ? 0 : Math.min(len, STICK_R);
      const inv = len > 0 ? eff / len : 0;
      this.touchMove.x = dx * inv;
      this.touchMove.y = dy * inv;
      touchStick.dx = this.touchMove.x;
      touchStick.dy = this.touchMove.y;
      // Push the stick to its rim and you run. Holding a separate sprint
      // button while steering and turning the camera needs a third thumb.
      touchStick.sprint = len >= STICK_R * 0.95;
      touchStick.version++;
      return;
    }
    if (this.pinch.has(e.pointerId)) this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch.size >= 2) {
      const [a, b] = [...this.pinch.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchPrev > 0) this.dZoom -= (d - this.pinchPrev) * 0.02;
      this.pinchPrev = d;
      return;   // a pinch is not a look
    }
    if (e.pointerId === this.touchLookId) {
      this.dYaw -= (e.clientX - this.touchLookPrev.x) * this.touchLookSensitivity;
      this.dPitch -= (e.clientY - this.touchLookPrev.y) * this.touchLookSensitivity;
      this.touchLookPrev = { x: e.clientX, y: e.clientY };
    }
  }

  private onTouchUp(e: PointerEvent) {
    if (e.pointerId === this.touchMoveId) {
      this.touchMoveId = -1;
      this.touchMove.x = 0; this.touchMove.y = 0; this.touchMove.active = false;
      touchStick.active = false;
      touchStick.sprint = false;
      touchStick.version++;
    }
    this.pinch.delete(e.pointerId);
    if (this.pinch.size < 2) this.pinchPrev = 0;
    if (e.pointerId === this.touchLookId) {
      this.touchLookId = -1;
      // hand the look over to whatever finger is still down on that side
      const next = [...this.pinch.keys()][0];
      if (next !== undefined) {
        this.touchLookId = next;
        this.touchLookPrev = { ...this.pinch.get(next)! };
      }
    }
  }

  /** Drop every finger the input layer thinks is still down. */
  private releaseTouches() {
    this.touchMoveId = -1;
    this.touchLookId = -1;
    this.pinch.clear();
    this.pinchPrev = 0;
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.touchMove.active = false;
    this.virtualSprint = false;
    touchStick.active = false;
    touchStick.sprint = false;
    touchStick.version++;
  }

  /** Called by on-screen buttons. */
  press(name: EdgeName) { this.virtualEdges.add(name); }
  setVirtualSprint(v: boolean) { this.virtualSprint = v; }

  /* ---------------- per-frame ---------------- */
  update(): InputFrame {
    const f = this.frame;
    const k = this.keys;
    if (!this.enabled) {
      Object.assign(f, EMPTY);
      this.dYaw = this.dPitch = this.dZoom = 0;
      this.edges.clear();
      this.virtualEdges.clear();
      return f;
    }

    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (this.touchMove.active) {
      // touchMove is a clamped pixel offset; one division puts it in [-1, 1].
      mx += this.touchMove.x / STICK_R;
      mz += this.touchMove.y / STICK_R;
    }

    // Gamepad — first connected pad wins.
    let padSprint = false;
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
      mx += dz(p.axes[0] ?? 0);
      mz += dz(p.axes[1] ?? 0);
      this.dYaw -= dz(p.axes[2] ?? 0) * 0.045;
      this.dPitch -= dz(p.axes[3] ?? 0) * 0.032;
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      if (btn(0)) this.edges.add('jump');
      if (btn(1)) this.edges.add('dodge');
      if (btn(2)) this.edges.add('attack');
      if (btn(3)) this.edges.add('interact');
      if (btn(4)) this.edges.add('lockOn');
      padSprint = btn(10) || (p.buttons[6]?.value ?? 0) > 0.5;
      break;
    }

    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    f.moveX = mx;
    f.moveZ = mz;

    f.lookYaw = this.dYaw;
    f.lookPitch = this.dPitch;
    f.zoom = this.dZoom;
    this.dYaw = this.dPitch = this.dZoom = 0;

    f.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || padSprint
      || this.virtualSprint || touchStick.sprint;

    for (const e of this.virtualEdges) this.edges.add(e);
    this.virtualEdges.clear();

    const take = (n: EdgeName) => { const v = this.edges.has(n); return v; };
    f.jump = take('jump');
    f.dodge = take('dodge');
    f.attack = take('attack');
    f.heavy = take('heavy');
    f.interact = take('interact');
    f.ability1 = take('ability1');
    f.ability2 = take('ability2');
    f.ability3 = take('ability3');
    f.lockOn = take('lockOn');
    f.map = take('map');
    f.journal = take('journal');
    f.pause = take('pause');
    this.edges.clear();

    f.anyKey = this.anyKeyFlag;
    this.anyKeyFlag = false;
    return f;
  }

  isDown(code: string) { return this.keys.has(code); }

  dispose() {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
