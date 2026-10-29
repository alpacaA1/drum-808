export interface KnobOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  label: string;
  valueText: (value: number) => string;
  onChange: (value: number) => void;
  /** Highlighted reference mark on the scale, e.g. the triplet feel on Swing. */
  mark?: { value: number; label: string };
}

/** One control for mouse, touch and keyboard; setValue never emits a change. */
export class Knob {
  private value: number;
  /**
   * mode is decided after a few pixels: a tangential move that starts on the outer ring turns the knob
   * like a real one (pointer angle follows the hand 1:1); anything else is the classic vertical drag.
   */
  private drag?: { pointer: number; x: number; y: number; startX: number; startY: number; cx: number; cy: number; radius: number; value: number; mode?: 'rotary' | 'vertical'; lost?: boolean };
  private wheelDelta = 0;
  private arc: SVGPathElement;

  constructor(private element: HTMLElement, private options: KnobOptions) {
    this.value = options.value;
    element.classList.add('knob');
    element.tabIndex = 0;
    element.setAttribute('role', 'slider');
    element.setAttribute('aria-valuemin', String(options.min));
    element.setAttribute('aria-valuemax', String(options.max));
    element.setAttribute('aria-orientation', 'vertical');
    this.setLabel(options.label);
    const ticks = Array.from({ length: 7 }, (_, index) => {
      const angle = (-135 + index * 45) * Math.PI / 180;
      return `<line x1="${50 + Math.sin(angle) * 44}" y1="${50 - Math.cos(angle) * 44}" x2="${50 + Math.sin(angle) * 48}" y2="${50 - Math.cos(angle) * 48}" />`;
    }).join('');
    let mark = '';
    if (options.mark) {
      const angle = (-135 + (options.mark.value - options.min) / (options.max - options.min) * 270) * Math.PI / 180;
      const at = (radius: number) => [50 + Math.sin(angle) * radius, 50 - Math.cos(angle) * radius];
      const [x1, y1] = at(42), [x2, y2] = at(50), [tx, ty] = at(60);
      mark = `<g class="knob-mark"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" /><text x="${tx}" y="${ty}">${options.mark.label}</text></g>`;
    }
    element.innerHTML = `<svg class="knob-scale" viewBox="0 0 100 100" aria-hidden="true"><g class="knob-ticks">${ticks}</g>${mark}<path class="knob-rail" d="M21.716 78.284 A40 40 0 1 1 78.284 78.284" pathLength="100"/><path class="knob-value-arc" d="M21.716 78.284 A40 40 0 1 1 78.284 78.284" pathLength="100"/></svg><span class="knob-grip" aria-hidden="true"><span class="knob-cap"></span><span class="knob-pointer"></span></span>`;
    this.arc = element.querySelector<SVGPathElement>('.knob-value-arc')!;
    this.setValue(options.value);
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.drag) return;
      event.preventDefault();
      element.focus({ preventScroll: true });
      const rect = element.getBoundingClientRect();
      this.drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, radius: rect.width / 2, value: this.value };
      element.setPointerCapture(event.pointerId);
      element.classList.add('is-dragging');
    });
    element.addEventListener('pointermove', event => {
      if (!this.drag || this.drag.pointer !== event.pointerId) return;
      const drag = this.drag;
      if (!drag.mode) {
        const mx = event.clientX - drag.startX, my = event.clientY - drag.startY;
        if (Math.hypot(mx, my) < 4) return;
        const rx = drag.startX - drag.cx, ry = drag.startY - drag.cy;
        const distance = Math.hypot(rx, ry);
        // Radial vs tangential share of the first movement, measured at the press point.
        const radial = distance ? Math.abs((mx * rx + my * ry) / distance) : Infinity;
        const tangential = distance ? Math.abs((mx * -ry + my * rx) / distance) : 0;
        drag.mode = distance >= drag.radius * 0.4 && tangential > radial ? 'rotary' : 'vertical';
        drag.x = drag.startX; drag.y = drag.startY;
      }
      const range = options.max - options.min;
      const fine = event.shiftKey ? 0.1 : 1;
      let delta: number;
      if (drag.mode === 'rotary') {
        // Angles near the centre are unstable; hold until the pointer is back out.
        // After crossing it, re-anchor instead of applying the jump across the centre.
        if (Math.hypot(event.clientX - drag.cx, event.clientY - drag.cy) < drag.radius * 0.25) { drag.lost = true; return; }
        if (drag.lost) { drag.lost = false; drag.x = event.clientX; drag.y = event.clientY; return; }
        const angle = (x: number, y: number) => Math.atan2(x - drag.cx, drag.cy - y);
        let turn = angle(event.clientX, event.clientY) - angle(drag.x, drag.y);
        if (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn < -Math.PI) turn += 2 * Math.PI;
        delta = turn * 180 / Math.PI / 270 * range * fine;
      } else {
        delta = (drag.y - event.clientY) * range / 200 * fine;
      }
      drag.x = event.clientX; drag.y = event.clientY;
      drag.value = this.clamp(drag.value + delta);
      this.change(drag.value);
    });
    const end = (event: PointerEvent) => { if (this.drag?.pointer === event.pointerId) this.endDrag(); };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', () => this.endDrag());
    window.addEventListener('blur', () => this.endDrag());
    element.addEventListener('wheel', event => {
      if (!event.deltaY) return;
      event.preventDefault();
      // A mouse notch (or line-mode event) is one step; small trackpad deltas accumulate to ~50 px per step.
      let steps = 0;
      if (event.deltaMode !== 0 || Math.abs(event.deltaY) >= 50) { steps = -Math.sign(event.deltaY); this.wheelDelta = 0; }
      else {
        this.wheelDelta += event.deltaY;
        if (Math.abs(this.wheelDelta) >= 50) { steps = -Math.sign(this.wheelDelta); this.wheelDelta -= Math.sign(this.wheelDelta) * 50; }
      }
      if (steps) this.change(this.value + steps * options.step);
    }, { passive: false });
    element.addEventListener('dblclick', () => { this.endDrag(); this.change(options.defaultValue); });
    element.addEventListener('keydown', event => {
      let value: number;
      switch (event.key) {
        case 'ArrowUp': case 'ArrowRight': value = this.value + options.step; break;
        case 'ArrowDown': case 'ArrowLeft': value = this.value - options.step; break;
        case 'PageUp': value = this.value + options.step * 10; break;
        case 'PageDown': value = this.value - options.step * 10; break;
        case 'Home': value = options.min; break;
        case 'End': value = options.max; break;
        default: return;
      }
      event.preventDefault();
      this.change(value);
    });
  }

  private clamp(value: number): number { return Math.min(this.options.max, Math.max(this.options.min, value)); }

  private change(value: number): void {
    const previous = this.value;
    this.setValue(value);
    if (this.value !== previous) this.options.onChange(this.value);
  }

  private endDrag(): void {
    const pointer = this.drag?.pointer;
    this.drag = undefined;
    this.element.classList.remove('is-dragging');
    if (pointer !== undefined && this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
  }

  setLabel(label: string): void { this.element.setAttribute('aria-label', label); }

  setValue(value: number): void {
    const { min, max, step } = this.options;
    // Small pointer deltas accumulate floating-point error; keep half-step snapping stable.
    this.value = this.clamp(min + Math.round((value - min) / step + 1e-9) * step);
    const ratio = (this.value - min) / (max - min);
    this.element.style.setProperty('--knob-angle', `${-135 + ratio * 270}deg`);
    this.arc?.setAttribute('stroke-dasharray', `${ratio * 100} 100`);
    // A zero-length dash still paints a round cap; hide the arc at the minimum.
    this.arc?.style.setProperty('visibility', ratio > 0 ? 'visible' : 'hidden');
    this.element.setAttribute('aria-valuenow', String(this.value));
    this.element.setAttribute('aria-valuetext', this.options.valueText(this.value));
  }
}
