import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LuminosityHighPassShader } from 'three/examples/jsm/shaders/LuminosityHighPassShader.js';
import { CLEAR_COLOR } from '../../src/render/engine';
import { clampBloomHighPass, GRADE_CINEMATIC, GRADE_SHADER } from '../../src/render/grade';
import { shipGlyph } from '../../src/render/glyphs';
import { CELESTIAL_HALO_GAIN, MAX_EMISSION, PALETTE, rgbOf } from '../../src/render/palette';
import { MAX_SYMBOL_PX, PointCloud, SHAPE, setSpritePixelRatio } from '../../src/render/points';
import { TECH } from '../../src/core/tech';

describe('linear, bounded plot energy', () => {
  it('converts sRGB tokens to Three’s working space exactly once', () => {
    for (const color of Object.values(PALETTE)) {
      new THREE.Color(color).toArray().forEach((value, i) => expect(rgbOf(color, 1)[i]).toBeCloseTo(value, 6));
    }
    expect(rgbOf(PALETTE.flash, 100)).toEqual(rgbOf(PALETTE.flash, MAX_EMISSION));
    expect(rgbOf(PALETTE.flash, -1)).toEqual([0, 0, 0]);
    expect(rgbOf(PALETTE.flash, Infinity)).toEqual([0, 0, 0]);
  });

  it('develops every frame through Site A grade: clamped bloom, exposure, ACES and gamma', () => {
    expect(clampBloomHighPass(LuminosityHighPassShader.fragmentShader)).toContain('min( texture2D( tDiffuse, vUv ), vec4( 6.0 ) )');
    expect(GRADE_CINEMATIC).toEqual({ exposure: 1.1, bloomStrength: 0.45, bloomRadius: 0.4, bloomThreshold: 1.1, vignette: 0.32 });
    expect(GRADE_SHADER.fragmentShader).toContain('c = aces(c);');
    expect(GRADE_SHADER.fragmentShader).toContain('pow(c, vec3(1.0 / 2.2))');
    expect(CLEAR_COLOR).toBe(0x000003);
  });

  it('keeps radial celestial masks and intentional carrier squares, with low-energy halos', () => {
    const glow = new PointCloud(1, true);
    const material = glow.points.material as THREE.ShaderMaterial;
    expect(material.fragmentShader).toContain('length(p)');
    expect(material.fragmentShader).toContain('step(max(abs(p.x), abs(p.y)), 0.8)');
    expect(material.fragmentShader).toContain('clamp(vColor, 0.0, 4.0)');
    expect(material.uniforms.alphaGain.value).toBeLessThan(0.5);
    expect(CELESTIAL_HALO_GAIN).toBe(0.08);
  });
});

describe('class glyph budgets', () => {
  it('distinguishes wall, pod wall, screen, carrier and LAC without unbounded pixel sizes', () => {
    expect(shipGlyph(TECH.classes.invictus, 'wall').shape).toBe(SHAPE.podWall);
    expect(shipGlyph(TECH.classes['saganami-c'], 'screen').shape).toBe(SHAPE.screen);
    const carrier = Object.values(TECH.classes).find((c) => c.hull === 'CLAC')!;
    const lac = Object.values(TECH.classes).find((c) => c.hull === 'LAC')!;
    expect(shipGlyph(carrier, 'carrier').shape).toBe(SHAPE.carrier);
    expect(shipGlyph(lac, 'lac').shape).toBe(SHAPE.lac);
    expect(shipGlyph(TECH.classes.invictus, 'wall', true, true).shape).toBe(SHAPE.ring);
    expect(shipGlyph(undefined, 'wall').shape).toBe(SHAPE.wall);
    for (const cls of Object.values(TECH.classes)) expect(shipGlyph(cls, cls.role, true).size).toBeLessThanOrEqual(MAX_SYMBOL_PX);
  });

  it('caps capacity, opacity and CSS size, and compensates for pixel ratio exactly once', () => {
    const cloud = new PointCloud(1);
    cloud.begin();
    cloud.push(1, 2, 3, rgbOf(PALETTE.ink, 1), 100, SHAPE.wall, 3);
    cloud.push(4, 5, 6, rgbOf(PALETTE.ink, 1), 1, SHAPE.wall);
    cloud.commit();
    expect(cloud.drawn).toBe(1);
    expect(cloud.points.geometry.getAttribute('size').getX(0)).toBe(MAX_SYMBOL_PX);
    expect(cloud.points.geometry.getAttribute('opacity').getX(0)).toBe(1);
    expect((cloud.points.material as THREE.ShaderMaterial).blending).toBe(THREE.NormalBlending);
    const scene = new THREE.Scene();
    scene.add(cloud.points);
    setSpritePixelRatio(scene, 2);
    expect((cloud.points.material as THREE.ShaderMaterial).uniforms.pixelRatio.value).toBe(2);
    expect(cloud.points.geometry.getAttribute('size').getX(0)).toBe(MAX_SYMBOL_PX);
  });
});
