import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyPlotInsets, fitPlotRadius, plotDistanceScale, plotSize, safePlotRect } from '../../src/render/framing';
import { placeLabel } from '../../src/render/labels';

describe('safe plot projection', () => {
  const insets = { top: 80, right: 310, bottom: 150, left: 70 };
  it('keeps a full-bleed viewport while moving the optical centre into the measured safe rectangle', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1e6);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    const rect = applyPlotInsets(camera, 1200, 800, insets);
    camera.updateMatrixWorld();
    const ndc = new THREE.Vector3().project(camera);
    expect((ndc.x + 1) * 600).toBeCloseTo(rect.x + rect.width / 2, 6);
    expect((1 - ndc.y) * 400).toBeCloseTo(rect.y + rect.height / 2, 6);
    expect(camera.view!.width).toBe(1200);
    expect(camera.view!.height).toBe(800);
    expect(camera.aspect).toBe(1.5);
    applyPlotInsets(camera, 1200, 800);
    expect(new THREE.Vector3().project(camera).toArray().slice(0, 2)).toEqual([0, 0]);
  });

  it('fits a physical sphere inside the safe rectangle in both landscape and portrait', () => {
    for (const [width, height] of [[1200, 800], [390, 844], [800, 800]]) {
      const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1e6);
      const reserved = { top: 60, right: width * 0.2, bottom: 120, left: 20 };
      const safe = applyPlotInsets(camera, width, height, reserved);
      camera.position.z = fitPlotRadius(camera, 10, width, height, reserved);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      for (let i = 0; i < 360; i++) {
        const angle = i * Math.PI / 180;
        for (const p of [new THREE.Vector3(10 * Math.cos(angle), 10 * Math.sin(angle), 0), new THREE.Vector3(10 * Math.cos(angle), 0, 10 * Math.sin(angle))]) {
          const ndc = p.project(camera);
          const x = (ndc.x + 1) * width / 2, y = (1 - ndc.y) * height / 2;
          expect(x).toBeGreaterThanOrEqual(safe.x);
          expect(x).toBeLessThanOrEqual(safe.x + safe.width);
          expect(y).toBeGreaterThanOrEqual(safe.y);
          expect(y).toBeLessThanOrEqual(safe.y + safe.height);
        }
      }
    }
  });

  it('clamps unusable insets without a zero-sized frustum', () => {
    expect(safePlotRect(100, 100, { top: 200, right: Infinity, bottom: -2, left: 200 })).toEqual({ x: 99, y: 99, width: 1, height: 1 });
    expect(safePlotRect(NaN, 0)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(plotSize(null, 0.5)).toEqual({ width: 500, height: 1000 });
  });

  it('expands portrait or occluded compositions, but leaves a wide unobstructed pose alone', () => {
    const camera = new THREE.PerspectiveCamera(50);
    expect(plotDistanceScale(camera, 1200, 800)).toBeCloseTo(1, 8);
    expect(plotDistanceScale(camera, 390, 844)).toBeGreaterThan(2);
    expect(plotDistanceScale(camera, 1200, 800, insets)).toBeGreaterThan(1);
  });
});

describe('safe HTML label placement', () => {
  const safe = { x: 70, y: 80, width: 500, height: 400 };
  it('fits the entire measured label box, not just its anchor', () => {
    const label = placeLabel(560, 475, 240, 60, safe, [])!;
    expect(label.x + label.width).toBeLessThanOrEqual(570);
    expect(label.y + label.height).toBeLessThanOrEqual(480);
    expect(label.x).toBeGreaterThanOrEqual(70);
    expect(label.y).toBeGreaterThanOrEqual(80);
  });
  it('places nearby labels without overlap, and hides unplaceable/off-plot ones', () => {
    const a = placeLabel(300, 300, 180, 45, safe, [])!;
    const b = placeLabel(300, 300, 180, 45, safe, [a])!;
    expect(b).not.toEqual(a);
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    expect(placeLabel(20, 20, 100, 40, safe, [])).toBeNull();
    expect(placeLabel(300, 300, 100, 401, safe, [])).toBeNull();
    expect(placeLabel(300, 300, 500, 400, safe, [safe])).toBeNull();
  });

  it('moves annotations clear of a hull exclusion and refuses a fully occupied plot', () => {
    const hull = { x: 150, y: 200, width: 300, height: 100 };
    const label = placeLabel(300, 250, 200, 40, safe, [], [hull])!;
    expect(label).not.toBeNull();
    expect(label.x + label.width <= hull.x || hull.x + hull.width <= label.x
      || label.y + label.height <= hull.y || hull.y + hull.height <= label.y).toBe(true);
    expect(placeLabel(300, 250, 200, 40, safe, [], [safe])).toBeNull();
  });
});
