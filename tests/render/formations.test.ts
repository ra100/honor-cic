import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fleetDisplayFormation, type FormationGlyph } from '../../src/render/formations';

describe('display-only fleet formations', () => {
  const width = 375, height = 844;
  const safe = { x: 0, y: 116, width, height: 510 };
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 10_000);
  camera.position.z = 1000;
  camera.updateMatrixWorld();
  const atPixel = (x: number, y: number) => new THREE.Vector3(x * 2 / width - 1, 1 - y * 2 / height, 0).unproject(camera);
  const pixel = (pos: THREE.Vector3) => {
    const p = pos.clone().project(camera);
    return new THREE.Vector2((p.x + 1) * width / 2, (1 - p.y) * height / 2);
  };
  const glyphsAt = (centre: THREE.Vector3, count = 100): FormationGlyph[] => Array.from({ length: count }, (_, ship) => ({
    ship, role: ship < 8 ? 'carrier' : 'wall', classId: ship < 8 ? 'minotaur' : 'invictus',
    flagship: ship === 8, size: 7, pos: centre.clone(),
  }));

  it('keeps crowded glyphs fully inside the safe plot when their true centre is near an edge', () => {
    for (const [x, y] of [[28, 360], [347, 360], [188, 140], [188, 602]]) {
      const centre = atPixel(x, y);
      const glyphs = glyphsAt(centre);
      const display = fleetDisplayFormation(glyphs, centre, camera, width, height, safe, 'edge');
      expect(display.schematic).toBe(true);
      display.positions.forEach((pos, i) => {
        const p = pixel(pos), half = glyphs[i].size / 2;
        expect(p.x - half).toBeGreaterThanOrEqual(safe.x);
        expect(p.x + half).toBeLessThanOrEqual(safe.x + safe.width);
        expect(p.y - half).toBeGreaterThanOrEqual(safe.y);
        expect(p.y + half).toBeLessThanOrEqual(safe.y + safe.height);
      });
    }
  });

  it('is stable by ship identity and leaves physical positions and quantities untouched', () => {
    const centre = atPixel(188, 360);
    const glyphs = glyphsAt(centre);
    const before = glyphs.map((g) => g.pos.toArray());
    const display = fleetDisplayFormation(glyphs, centre, camera, width, height, safe, 'identity', 80);
    const reversed = [...glyphs].reverse();
    const reordered = fleetDisplayFormation(reversed, centre, camera, width, height, safe, 'identity', 80);
    expect(display.positions).toHaveLength(100);
    expect(glyphs.map((g) => g.pos.toArray())).toEqual(before);
    expect(reordered.positions.map((p) => p.toArray()).reverse()).toEqual(display.positions.map((p) => p.toArray()));
    expect(display.positions.every((p) => pixel(p).distanceTo(pixel(centre)) <= 80.000001)).toBe(true);
    const mean = display.positions.reduce((sum, p) => sum.add(pixel(p)), new THREE.Vector2()).divideScalar(100);
    expect(mean.distanceTo(pixel(centre))).toBeLessThan(1e-6);
    const carrierX = display.positions.slice(0, 8).map((p) => pixel(p).x);
    const wallX = display.positions.slice(8).map((p) => pixel(p).x);
    expect(Math.max(...carrierX)).toBeLessThanOrEqual(Math.min(...wallX));
  });

  it('preserves already separated physical glyphs instead of spreading every fleet', () => {
    const centre = atPixel(188, 360);
    const glyphs = glyphsAt(centre, 2);
    glyphs[0].pos = atPixel(150, 360);
    glyphs[1].pos = atPixel(226, 360);
    const display = fleetDisplayFormation(glyphs, centre, camera, width, height, safe, 'separated');
    expect(display.schematic).toBe(false);
    expect(display.positions.map((p) => p.toArray())).toEqual(glyphs.map((g) => g.pos.toArray()));
    expect(display.positions[0]).not.toBe(glyphs[0].pos);
  });

  it('uses the available rectangle without compressing glyphs to the nearest circular edge', () => {
    const centre = atPixel(58, 360);
    const glyphs = glyphsAt(centre);
    const display = fleetDisplayFormation(glyphs, centre, camera, width, height, safe, 'rectangle');
    const pixels = display.positions.map(pixel);
    let gap = Infinity;
    pixels.forEach((p, i) => {
      for (const other of pixels.slice(0, i)) gap = Math.min(gap, p.distanceTo(other));
    });
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(pixels.every((p) => p.x >= 3.5 && p.x <= width - 3.5
      && p.y >= safe.y + 3.5 && p.y <= safe.y + safe.height - 3.5)).toBe(true);
  });
});
