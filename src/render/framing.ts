import type { PerspectiveCamera } from 'three';

export interface PlotInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const finiteInset = (value: number | undefined): number => Number.isFinite(value) ? Math.max(0, value!) : 0;
const dimension = (value: number): number => Number.isFinite(value) ? Math.max(1, value) : 1;

export function safePlotRect(width: number, height: number, insets?: PlotInsets): PlotRect {
  const w = dimension(width);
  const h = dimension(height);
  const left = Math.min(w - 1, finiteInset(insets?.left));
  const right = Math.min(w - left - 1, finiteInset(insets?.right));
  const top = Math.min(h - 1, finiteInset(insets?.top));
  const bottom = Math.min(h - top - 1, finiteInset(insets?.bottom));
  return { x: left, y: top, width: w - left - right, height: h - top - bottom };
}

/** Shift the optical centre without cropping the full-bleed canvas. Insets are CSS pixels. */
export function applyPlotInsets(camera: PerspectiveCamera, width: number, height: number, insets?: PlotInsets): PlotRect {
  const w = dimension(width);
  const h = dimension(height);
  const rect = safePlotRect(w, h, insets);
  const x = w / 2 - rect.x - rect.width / 2;
  const y = h / 2 - rect.y - rect.height / 2;
  const view = camera.view;
  if (!view?.enabled || view.fullWidth !== w || view.fullHeight !== h || view.offsetX !== x || view.offsetY !== y) {
    camera.setViewOffset(w, h, x, y, w, h);
  }
  return rect;
}

export function plotDistanceScale(camera: PerspectiveCamera, width: number, height: number, insets?: PlotInsets): number {
  return fitPlotRadius(camera, 1, width, height, insets, 1) / fitPlotRadius(camera, 1, height, height, undefined, 1);
}

export function fitPlotRadius(camera: PerspectiveCamera, radius: number, width: number, height: number, insets?: PlotInsets, padding = 1.12): number {
  const rect = safePlotRect(width, height, insets);
  const vertical = Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
  const halfAngle = Math.min(
    Math.atan(vertical * rect.height / dimension(height)),
    Math.atan(vertical * rect.width / dimension(height)),
  );
  return Math.max(camera.near * 2, Math.max(0, radius) * padding / Math.sin(halfAngle));
}

export function plotSize(dom: HTMLElement | null, aspect: number): { width: number; height: number } {
  return dom
    ? { width: Math.max(1, dom.clientWidth), height: Math.max(1, dom.clientHeight) }
    : { width: Math.max(0.001, Number.isFinite(aspect) ? aspect : 1) * 1000, height: 1000 };
}
