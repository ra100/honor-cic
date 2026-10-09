import type { PlotInsets } from '../../render/framing';

export interface PlotRect { left: number; top: number; right: number; bottom: number }
export interface PlotOccupancy { edge: keyof PlotInsets; rect: PlotRect }

export function occupiedPlotInsets(plot: PlotRect, occupied: PlotOccupancy[], gap = 8): PlotInsets {
  const insets: PlotInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const { edge, rect } of occupied) {
    if (rect.right <= plot.left || rect.left >= plot.right || rect.bottom <= plot.top || rect.top >= plot.bottom) continue;
    const depth = edge === 'top' ? rect.bottom - plot.top
      : edge === 'bottom' ? plot.bottom - rect.top
        : edge === 'left' ? rect.right - plot.left : plot.right - rect.left;
    const limit = edge === 'top' || edge === 'bottom' ? plot.bottom - plot.top : plot.right - plot.left;
    insets[edge] = Math.max(insets[edge], Math.min(limit, Math.max(0, depth + gap)));
  }
  return insets;
}
