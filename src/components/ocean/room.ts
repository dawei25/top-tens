/**
 * Open water: the viewport minus the glass (every [data-glass] rect, plus a few bare UI bits such as Home's logo),
 * as the roaming squid sees it on wide screens. Where there is room for it, the squid lives entirely in open water,
 * limbs included: the swim plans every turn and every glide against this, and stops short of the glass.
 *
 * The squid's silhouette is kept inside an envelope: a disc behind its head (the mantle on one side, the trailing
 * limbs on the other), which turns with it about the head's pivot. A pose fits when the disc, plus a margin, is clear
 * of the glass and inside the viewport. A spot is free (room to turn round in place) when every heading fits there.
 * A strip of open water too thin to turn round in (beside a centred column, say) still holds the squid upright: it
 * swims up head-first and sinks back down.
 *
 * Pure geometry in viewport CSS px, no DOM: the engine builds a Room from the rects it reads after a resize, a scroll
 * or an event, never per frame.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const RAD = Math.PI / 180;
/** The envelope in sprite px: its centre this far behind the head's pivot (along the body), and its radius. */
export const ENV_BACK = 16;
export const ENV_R = 26.5;
/** CSS px kept between the envelope and the glass (or the viewport's edges). */
export const MARGIN = 12;
/** Sampling step for glides and turns: CSS px, degrees. */
const STEP_PX = 10;
const STEP_DEG = 10;
/** Turning, the limbs lag behind the body and swing out a little: a turn keeps this much more clear (CSS px), less
 *  for a small turn (half a px per degree). */
const TURN_SLACK = 24;
/** Room is only used if the squid fits somewhere with this much slack to spare (else it lives behind the glass). */
const ROOM_SLACK = 16;
/** Headings tried for the best fit at a spot: upright first. */
const HEADINGS = [0, 30, -30, 60, -60, 90, -90, 135, -135, 180];

export class Room {
  readonly w: number;
  readonly h: number;
  /** CSS px: the envelope's centre behind the pivot, and its radius plus the margin. */
  readonly back: number;
  readonly r: number;
  private boxes: Box[];

  constructor(boxes: Box[], w: number, h: number, px: number) {
    this.boxes = boxes;
    this.w = w;
    this.h = h;
    this.back = ENV_BACK * px;
    this.r = ENV_R * px + MARGIN;
  }

  /**
   * The room for a layout, or null when the glass leaves no open water the squid fits in (a phone; a narrow screen
   * whose side strips are too thin). Sampled on a grid: the envelope fits where a point is clear by its radius.
   */
  static build(boxes: Box[], w: number, h: number, px: number): Room | null {
    const room = new Room(boxes, w, h, px);
    const step = 24;
    for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) if (room.clear(x, y) >= room.r + ROOM_SLACK) return room;
    return null;
  }

  /** Same glass, same viewport: no need to rebuild. */
  same(boxes: Box[], w: number, h: number) {
    return (
      w === this.w &&
      h === this.h &&
      boxes.length === this.boxes.length &&
      boxes.every((b, i) => {
        const o = this.boxes[i];
        return Math.abs(b.left - o.left) < 1 && Math.abs(b.top - o.top) < 1 && Math.abs(b.right - o.right) < 1 && Math.abs(b.bottom - o.bottom) < 1;
      })
    );
  }

  /**
   * How far a point is from the nearest glass or viewport edge (negative inside glass, by how deep). With `seabed`,
   * the bottom edge doesn't count (limbs resting on the seabed).
   */
  clear(x: number, y: number, seabed = false) {
    let best = Math.min(x, this.w - x, y, seabed ? Infinity : this.h - y);
    for (const r of this.boxes) {
      const dx = Math.max(r.left - x, x - r.right);
      const dy = Math.max(r.top - y, y - r.bottom);
      const d = dx <= 0 && dy <= 0 ? Math.max(dx, dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
      if (d < best) best = d;
    }
    return best;
  }

  /** The envelope's slack at a pose (heading in degrees, 0 up): 0 or more fits. */
  fit(x: number, y: number, tilt: number, seabed = false) {
    const cx = x - Math.sin(tilt * RAD) * this.back;
    const cy = y + Math.cos(tilt * RAD) * this.back;
    return this.clear(cx, cy, seabed) - this.r;
  }

  /** The heading that fits here: upright if that fits, else the best fit; and its slack (< 0 if none fits). */
  best(x: number, y: number): { h: number; slack: number } {
    let h = 0;
    let slack = this.fit(x, y, 0);
    if (slack >= 0) return { h, slack };
    for (const a of HEADINGS) {
      const s = this.fit(x, y, a);
      if (s > slack + 4) {
        slack = s;
        h = a;
      }
    }
    return { h, slack };
  }

  /** Slack for turning all the way round in place here: 0 or more is free. */
  free(x: number, y: number) {
    return this.clear(x, y) - this.back - this.r;
  }

  /**
   * The way to turn in place from heading `from` to `to` keeping clear: 1 (clockwise), -1, or 0 for no turn needed;
   * null when neither way fits. The shorter way first.
   */
  sweep(x: number, y: number, from: number, to: number): 1 | -1 | 0 | null {
    const d = to - from - 360 * Math.round((to - from) / 360);
    if (Math.abs(d) < 2) return 0;
    const ways: (1 | -1)[] = d > 0 ? [1, -1] : [-1, 1];
    for (const dir of ways) {
      const span = dir > 0 ? (d > 0 ? d : d + 360) : d < 0 ? -d : 360 - d;
      let ok = true;
      const slack = Math.min(TURN_SLACK, span * 0.5);
      for (let a = STEP_DEG; ok && a < span + STEP_DEG; a += STEP_DEG) ok = this.fit(x, y, from + dir * Math.min(a, span)) >= slack;
      if (ok) return dir;
    }
    return null;
  }

  /** How far it can glide from (x, y) along heading `h` keeping clear, up to `max` CSS px. */
  reach(x: number, y: number, h: number, max: number) {
    const ux = Math.sin(h * RAD);
    const uy = -Math.cos(h * RAD);
    let d = 0;
    while (d < max) {
      const n = Math.min(max, d + STEP_PX);
      if (this.fit(x + ux * n, y + uy * n, h) < 0) return d;
      d = n;
    }
    return max;
  }

  /** How far it can sink straight down from (x, y) at heading `tilt`, keeping clear, up to `max` CSS px. */
  drop(x: number, y: number, tilt: number, max: number, seabed = false) {
    let d = 0;
    while (d < max) {
      const n = Math.min(max, d + STEP_PX);
      if (this.fit(x, y + n, tilt, seabed) < 0) return d;
      d = n;
    }
    return max;
  }

  /** A straight glide from a to b fits all the way (heading along it). */
  line(ax: number, ay: number, bx: number, by: number) {
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 1) return this.fit(ax, ay, 0) >= 0;
    return this.reach(ax, ay, Math.atan2(bx - ax, -(by - ay)) / RAD, d) >= d;
  }
}
