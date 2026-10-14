import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { solve } from '../../../src/core/solver/solve';
import { TECH } from '../../../src/core/tech';
import { BeamBatch } from '../../../src/render/engagement/fx';
import { EngagementView } from '../../../src/render/scales/engagement-view';
import { getPack } from '../../../src/registry';

const material = (b: BeamBatch) => b.mesh.material as THREE.ShaderMaterial;

describe('BeamBatch', () => {
  it('adds beams by default and keeps only the brightest with max blending', () => {
    expect(material(new BeamBatch(1)).blending).toBe(THREE.AdditiveBlending);
    const max = material(new BeamBatch(1, 2, 'max'));
    expect(max.blending).toBe(THREE.CustomBlending);
    expect(max.blendEquation).toBe(THREE.MaxEquation);
  });

  it('clamps the falloff so edge pixels past a thin beam cannot overflow to white', () => {
    expect(material(new BeamBatch(1)).fragmentShader).toMatch(/float a = max\(0\.0, 1\.0 - vQ\.y \* vQ\.y\);/);
  });

  it('draws Apollo telemetry links with max blending, so a fan seen edge-on stays one violet thread', () => {
    const pack = getPack('training')!;
    const v = new EngagementView(pack, solve(pack, TECH), null);
    expect(material((v as unknown as { links: BeamBatch }).links).blendEquation).toBe(THREE.MaxEquation);
  });
});
