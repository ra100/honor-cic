# Battle of Manticore: sources and caveats

The viewer replays a reconstruction. Every number carries an evidence label:

- **P**: a novel or the author, as quoted by the MTS.
- **W**: the Honorverse wiki or the project's MTS reference tables.
- **D**: derived by calculation from sourced inputs.
- **S**: speculative. These are reconstructions and provisional values, never canon.

## Sources
- Battle of Manticore, Honorverse wiki: https://honorverse.fandom.com/wiki/Battle_of_Manticore
- Honorverse Master Technical Specification (MTS), the project's reference document, in `docs/`.
- David Weber, *On Basilisk Station*, as quoted by the MTS for the 22 LM hyper limit.

## Naming
This is the Battle of Manticore (Operation Beatrice was the Havenite plan). Prefixing the title with "Eighth" is wrong: "Eighth" refers to Harrington's Eighth Fleet, not to a numbered battle (MTS §10.1).

## Motion model
Missiles fly a narrative-calibrated classical profile:
- The Mk23 runs three 180 s stages at the 48,000 g half setting, with a ballistic coast before the last stage.
- Burnout from rest is about 0.85c. The wiki reports 0.83c and Weber's FAQ 0.81c (MTS §4.4), and both are kept as reference values.
- Nothing is forced to arrive on time, and nothing exceeds c.

## Known conflicts and choices
- **Alliance LAC recovery (S)**: the surviving Alliance LACs are recovered at T+40:00, after their strike. Second Fleet's LACs stay on the plot because they are captured with the fleet (W).
- **LAC strike timing (S)**: the dogfight is timed to when the swarms are within 150,000 km of each other (T+30:53 to T+30:57), and the Shrike graser pass to 75,000 km of Second Fleet (T+31:08 to T+31:10), both from the scenario's own geometry. The swarms close at over 50,000 km/s (W), so each pass lasts seconds.
- **Ferret flush (S beyond W)**: 300 Ferrets flush all 16,000 missiles at 180,000 km (W). At over 50,000 km/s that range closes in about 3.5 s, so the flush is two ripples a second apart, both before the pass. A LAC wing flies as squadrons of twelve spread across a front about 310,000 km in radius, and each packet is fired by the squadron in its target's lane. The missiles reach Second Fleet 2–3 s after launch; fired from the wing's centre they could only turn round after the pass and return minutes later.
- **No fleet-wide defensive rolls**: a wall of battle firing its own salvos keeps its broadside to the enemy. An earlier draft rolled Home Fleet and Fifth Fleet 90° before the missiles arrived; with the wedge then facing the threat every leaker struck the stress band, which contradicts the canon losses. Rolls stay available for ships and smaller scenarios.
- **Missile lethality (calibration, S)**: `hit_fraction` is 0.09 for the Mk23 and Mk16 and 0.075 for the Havenite MDM. With these, mechanistic damage knocks out about 109 of Second Fleet's 240 SD(P) under Home Fleet's 150,000 missiles (canon: 97 destroyed and 19 mission kills), destroys all of Home Fleet and Third Fleet, and leaves Fifth Fleet intact until the Apollo strike.
- **Havenite defense preset (calibration, S)**: 5 counter-missile waves at Pk 0.62 and 7 point-defense shots at Pk 0.58 per mount. Fifth Fleet then stops 28% of the Apollo strike (canon: about 30%).
- **Sphinx orbit**: the scenario keeps 15.30 LM (S). Kepler with Sphinx's 5.22-year period gives about 26 LM (MTS §2.2). The conflict is shown, not hidden.
- **Draco and Roc**: the order is Draco A-V, then Roc A-VI. The draft's radii follow their orbital slots.
- **Resonance zone (S)**: drawn and enforced as a cone from Manticore-A (base radius 22 LM, the provisional 44 LM base of MTS Appendix A) to the Junction terminus. The novel describes a roughly conical volume with spurs and clear approaches (MTS §2.6); no map fixes its width. Every hyper emergence, departure and escape is checked against it.
- **Sphinx and Manticore phases (S)**: taken from the supplied tactical map (Sphinx at (-12.0, 9.5) LM, Manticore at (0, -12.4) LM, the Junction at 45°) and rotated into this frame, so Sphinx sits at 96.6° from the Junction axis. The Sphinx approaches then lie just behind the resonance zone's base, where Second Fleet could have translated in.
- **Third Fleet placement**: the wiki says Third Fleet emerged "extremely close to the RZ's boundary, closer to Sphinx than 2nd Fleet". It emerges 22.6 LM from A, about 7 Mkm outside the resonance-zone boundary, on Second Fleet's Junction-side flank. "Closer to Sphinx" cannot hold: a hyper emergence lies at least 120 Mkm from Sphinx at 15.3 LM, and Second Fleet fights within 89 Mkm of it. The two W range facts (60 Mkm after 26 minutes, 36 Mkm at Paul Revere) are kept exactly.
- **Second front (S)**: Fifth Fleet translates in astern of Third Fleet, 66 Mkm from it and outside both the limit and the zone, because the wiki has Chin's salvos and McKeon's replies cross between Fifth and Third Fleets. Eighth Fleet's single jump from the Junction ends 78 Mkm (W) further out on that line, 173 Mkm from Second Fleet. Both original visualizers instead put Fifth and Eighth Fleets about 44 LM across the primary; that layout cannot keep Fifth Fleet within missile range of Third Fleet.
- **LAC counts**: the wiki says almost 3,000 LACs died with Home Fleet. The LAC strike accounts for 1,493, and the casualty box gives 2,806 Alliance LACs in total. Only the strike's 1,493 are modeled, so 1,313 Alliance LAC losses are unattributed.
- **Havenite screen losses**: the casualty box lists 64 BC and 54 CA destroyed. The modeled screen accounts for 33 BC and 41 CA. Diamato's 32 battlecruisers escaped. The remainder is unattributed.
- **Fifth Fleet's carriers**: the 30 CLACs and about 5,000 LACs are not placed. The sources do not show them engaged.
- **Flagship names**: HMS Invictus (Home Fleet), RHNS Guerriere (Second Fleet) and HMS Imperator (Eighth Fleet) are unverified (S). RHNS Canonnade is W.
- **Fifth Fleet's escapees**: seventeen ships escaped (W). The assumption that their generators were already spun up is S. It makes the "two minutes too late" order consistent with readiness times (MTS §3.5).
- **Defense calibration**: CM and PD constants are S, tuned so that Fifth Fleet stops about 30% of the Apollo strike (W). The `canon` validator reports the solved share.
- **Damage**: canon loss counts are enforced exactly. Which individual ship received which result is a reconstruction ranked by modeled damage (S).
