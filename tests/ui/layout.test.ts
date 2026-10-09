import { describe, expect, it } from 'vitest';
import { occupiedPlotInsets } from '../../src/ui/viewer/layout';

describe('current-composition plot occupancy', () => {
  it('reserves header, transport and a hull workspace without permanently reserving battle panels', () => {
    const plot = { left: 0, top: 0, right: 1440, bottom: 900 };
    expect(occupiedPlotInsets(plot, [
      { edge: 'top', rect: { left: 8, top: 8, right: 1432, bottom: 60 } },
      { edge: 'top', rect: { left: 8, top: 76, right: 650, bottom: 124 } },
      { edge: 'left', rect: { left: 8, top: 140, right: 296, bottom: 440 } },
      { edge: 'bottom', rect: { left: 8, top: 804, right: 1432, bottom: 892 } },
    ])).toEqual({ top: 132, left: 304, bottom: 104, right: 0 });
  });

  it('reserves a narrow-screen sheet below the unobstructed plot, not as a desktop sidebar', () => {
    const plot = { left: 0, top: 0, right: 375, bottom: 844 };
    expect(occupiedPlotInsets(plot, [
      { edge: 'top', rect: { left: 6, top: 6, right: 369, bottom: 104 } },
      { edge: 'bottom', rect: { left: 6, top: 500, right: 369, bottom: 838 } },
    ])).toEqual({ top: 112, bottom: 352, left: 0, right: 0 });
  });

  it('measures relative to the actual plot bounds and ignores absent or external chrome', () => {
    const plot = { left: 20, top: 30, right: 620, bottom: 430 };
    expect(occupiedPlotInsets(plot, [])).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(occupiedPlotInsets(plot, [
      { edge: 'right', rect: { left: 500, top: 100, right: 610, bottom: 400 } },
      { edge: 'top', rect: { left: 0, top: 0, right: 10, bottom: 10 } },
    ])).toEqual({ top: 0, right: 128, bottom: 0, left: 0 });
  });
});
