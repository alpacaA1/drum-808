export interface KnobOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  label: string;
  valueText: (value: number) => string;
  onChange: (value: number) => void;
}

/** One control for mouse, touch and keyboard; setValue never emits a change. */
export class Knob {
  private value: number;
  private drag?: { pointer: number; y: number; value: number };
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
    element.innerHTML = `<svg class="knob-scale" viewBox="0 0 100 100" aria-hidden="true"><g class="knob-ticks">${ticks}</g><path class="knob-rail" d="M21.716 78.284 A40 40 0 1 1 78.284 78.284" pathLength="100"/><path class="knob-value-arc" d="M21.716 78.284 A40 40 0 1 1 78.284 78.284" pathLength="100"/></svg><span class="knob-grip" aria-hidden="true"><span class="knob-cap"></span><span class="knob-pointer"></span></span>`;
    this.arc = element.querySelector<SVGPathElement>('.knob-value-arc')!;
    this.setValue(options.value);
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.drag) return;
      event.preventDefault();
      element.focus({ preventScroll: true });
      this.drag = { pointer: event.pointerId, y: event.clientY, value: this.value };
      element.setPointerCapture(event.pointerId);
      element.classList.add('is-dragging');
    });
    element.addEventListener('pointermove', event => {
      if (!this.drag || this.drag.pointer !== event.pointerId) return;
      const scale = (options.max - options.min) / 200 * (event.shiftKey ? 0.1 : 1);
      this.drag.value = this.clamp(this.drag.value + (this.drag.y - event.clientY) * scale);
      this.drag.y = event.clientY;
      this.change(this.drag.value);
    });
    const end = (event: PointerEvent) => { if (this.drag?.pointer === event.pointerId) this.endDrag(); };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', () => this.endDrag());
    window.addEventListener('blur', () => this.endDrag());
    element.addEventListener('wheel', event => {
      if (!event.deltaY) return;
      event.preventDefault();
      this.change(this.value + (event.deltaY < 0 ? 1 : -1) * options.step);
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
    this.element.setAttribute('aria-valuenow', String(this.value));
    this.element.setAttribute('aria-valuetext', this.options.valueText(this.value));
  }
}
