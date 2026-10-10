import { describe, expect, it } from 'vitest';
import {
  barycentre, fleetShortName, limitText, lmText, planetDesignation, planetLook, planetSubtitle, resonanceLabel, roman, starSubtitle, systemCatalog,
} from '../../../src/render/system/catalog';
import { baseValue } from '../../../src/core/evidence';
import { bodyPosition, indexBodies } from '../../../src/core/solver/orbits';
import { LM_KM } from '../../../src/core/units';
import { dist } from '../../../src/core/vec';
import { getPack } from '../../../src/registry';

const manticore = getPack('manticore')!;
const training = getPack('training')!;
const index = indexBodies(manticore.bodies);
const body = (id: string) => index.get(id)!;

describe('system catalog', () => {
  it('sorts bodies by role without assuming ids', () => {
    const c = systemCatalog(manticore);
    expect(c.origin.id).toBe(manticore.meta.frame.origin_body);
    expect(c.companion?.kind).toBe('star');
    expect(c.termini.map((b) => b.id)).toEqual(['junction']);
    expect(c.stations.length).toBe(2);
    const t = systemCatalog(training);
    expect(t.origin.id).toBe('range-star');
    expect(t.companion).toBeNull();
    expect(t.termini).toEqual([]);
  });

  it('writes Roman designations from the parent star and the ordinal', () => {
    expect(roman(3)).toBe('III');
    expect(roman(4)).toBe('IV');
    expect(roman(9)).toBe('IX');
    expect(planetDesignation(body('manticore'), index)).toBe('Manticore-A III');
    expect(planetDesignation(body('gryphon'), index)).toBe('Manticore-B V');
  });

  it("builds Site A's planet subtitles from pack data only", () => {
    expect(planetSubtitle(body('manticore'), index)).toBe('Manticore-A III · 12.4 LM · HMSS Hephaestus');
    expect(planetSubtitle(body('sphinx'), index)).toBe('Manticore-A IV · 15.3 LM · HMSS Vulcan');
    // "gas giant" is the pack's own wording ("gas giant radius not in the MTS").
    expect(planetSubtitle(body('draco'), index)).toBe('Manticore-A V · 28.5 LM · gas giant');
    expect(planetSubtitle(body('salamander'), index)).toBe('Manticore-A I · 1.75 LM');
    // Facts the originals printed but this pack does not carry stay out.
    for (const p of manticore.bodies.filter((b) => b.kind === 'planet')) {
      expect(planetSubtitle(p, index)).not.toMatch(/capital|ocean|treecat|moons|\d g\b/);
    }
  });

  it('labels stars with the role, the mass and the separation the pack gives', () => {
    expect(starSubtitle(body('manticore-a'), index)).toBe('Primary · 1.12 solar masses');
    expect(starSubtitle(body('manticore-b'), index)).toBe('Companion · 0.92 solar masses · 739 LM from Manticore-A');
    expect(starSubtitle(training.bodies[0], indexBodies(training.bodies))).toBe('1 solar mass');
  });

  it('formats hyper limits as Site A does and flags speculative ones', () => {
    expect(limitText(body('manticore-a'))).toBe('Manticore-A · 22.00 LM hyper limit');
    expect(limitText(body('manticore-b'))).toBe('Manticore-B · 22.12 LM hyper limit [S]');
    expect(limitText(body('sphinx'))).toBeNull();
    expect(lmText(412 * LM_KM)).toBe('412 LM');
  });

  it('labels the resonance zone from its base radius and says it is provisional', () => {
    expect(resonanceLabel(body('junction'))).toEqual({ text: 'Resonance zone', sub: 'Provisional 44 LM cone · hyper translation lethal [S]' });
    expect(resonanceLabel(body('manticore-a'))).toBeNull();
  });

  it("puts the barycentre where the stars' masses do: 333 LM from A, 406 LM from B, as Site A drew it", () => {
    const b = barycentre(body('manticore-a'), body('manticore-b'), index, 0)!;
    expect(dist(b, bodyPosition(index, 'manticore-a', 0)) / LM_KM).toBeCloseTo(333.3, 0);
    expect(dist(b, bodyPosition(index, 'manticore-b', 0)) / LM_KM).toBeCloseTo(405.7, 0);
  });

  it('shades giants as giants and Earth-sized worlds with oceans', () => {
    const limit = baseValue(body('manticore-a').hyper_limit);
    expect(planetLook(body('draco'), limit)).toBe('gas-giant');
    expect(planetLook(body('roc'), limit)).toBe('gas-giant');
    expect(planetLook(body('wyvern'), limit)).toBe('ice-giant');
    expect(planetLook(body('manticore'), limit)).toBe('terrestrial');
    expect(planetLook(body('sphinx'), limit)).toBe('terrestrial');
    expect(planetLook(body('salamander'), limit)).toBe('rocky');
  });

  it('shortens fleet names for Site B callouts', () => {
    expect(fleetShortName('Home Fleet')).toBe('HOME');
    expect(fleetShortName('Second Fleet')).toBe('SECOND');
    expect(fleetShortName('Eighth Fleet screen')).toBe('EIGHTH SCREEN');
    expect(fleetShortName("Diamato's task group")).toBe('DIAMATO');
    expect(fleetShortName('Training squadron Blue')).toBe('BLUE');
  });
});
