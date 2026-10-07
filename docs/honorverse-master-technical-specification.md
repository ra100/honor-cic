# Honorverse Master Technical Specification: Astrophysics, Ship Engineering, Ordnance & Tactical Simulation Data

**Expanded and reviewed edition — 6 October 2026**  
**Scope:** Honorverse technical reference, with emphasis on the late First and Second Haven–Manticore Wars and the 1921 PD Battle of Manticore. Later developments are identified separately.  
**Revision basis:** the supplied specification, supplemented with Honorverse Wiki articles, author explanations, and publisher-hosted material.

## 1. System Framework & Operating Standards

### 1.1 Purpose and evidence policy

This report supports tactical visualization, ship modeling, and battle simulation. Its original six subject areas are retained and extended with sensor behavior, fire-control limits, missile kinematics, damage modeling, logistics, and implementation guidance.

The supplied draft contained useful detail but overstated its provenance: not every coordinate, engineering value, or visual description could be traced to a primary technical record. This revision therefore uses four evidence labels:

| Label | Meaning | Appropriate use |
| --- | --- | --- |
| **P — Primary** | Directly supported by an author explanation or publisher-hosted narrative/reference excerpt | Setting rule, with the cited passage's era and context |
| **W — Wiki-supported** | Supported by a retrieved Honorverse Wiki article or indexed article extract | Secondary reference; retain its underlying book reference where available |
| **D — Derived** | Calculated from explicitly stated inputs | Unit conversion, timing, geometry, or consistency check |
| **S — Simulation / provisional** | Modeling choice, inherited unverified value, or reconstruction | Scenario configuration; never present as established canon |

Numbered references link to the source register in Section 13. Facts summarized from wiki articles are paraphrased; their source abbreviations are identified where useful. A wiki's infobox may contain transcription errors or combine different refits. A precise number is not automatically a reliable number.

**Research limitation:** direct retrieval of many Fandom article pages was blocked. Wiki-supported additions below use the article text returned by indexed search, rather than claiming a complete inspection of every page, revision history, diagram, or underlying novel. Relevant author and Baen material was used to check major mechanics. The full paid technical appendices of *House of Steel* were not available in the retrieved sample; its table of contents establishes the reference's coverage, not individual ship statistics. [1–3]

### 1.2 Units and coordinate frames

Use a single physical unit system internally. Recommended: kilometers, seconds, metric tonnes, and km/s². Display LM, light-seconds, or Mkm only as conversions.

| Quantity | Conversion / convention |
| --- | --- |
| Speed of light, \(c\) | 299,792.458 km/s |
| Standard gravity, \(g_0\) | 9.80665 m/s² = 0.00980665 km/s² |
| 1 light-second (LS) | 299,792.458 km |
| 1 light-minute (LM) | 17,987,547.48 km = 17.98754748 Mkm |
| 1 light-hour (LH) | 1,079.2528488 Mkm |
| 1 astronomical unit (AU) | 149,597,870.7 km |
| PD | Post Diaspora; setting calendar designation |
| T-day / T-year | Terran day / year; do not substitute a planet's local calendar |

**D:** the draft's initial conversion of 739 LM to \(1.329\times10^8\) km was wrong by a factor of 100. The correct distance is approximately \(1.32928\times10^{10}\) km, or 13,292.80 Mkm.

For a Manticore-A tactical map, define the primary at `(0,0,0)` and explicitly declare the scenario's axes. For example: +X toward the Junction's projected direction, +Y in the selected reference plane, and +Z normal to that plane. These directions are an **S** map convention, not a universal astronomical orientation.

Separate three quantities:

1. **Orbit size:** radius or semimajor axis around the parent star.
2. **Instantaneous position:** coordinates at an explicit epoch.
3. **Rendered position:** the physical coordinates after camera projection and display scaling.

An orbital radius alone does not establish a planet's X/Y coordinates, orbital phase, inclination, or apparent location on a screenshot. Store Manticore-B planets relative to B, then transform into the selected system frame. Apply the same transform to planets, orbit lines, fleets, range rings, and resonance-zone overlays.

### 1.3 Technology must be dated

Assign capabilities to individual ships and refits at the scenario date. A class being introduced does not mean every fleet has it; possessing a compatible missile does not imply possession of its best control architecture. Keep separate technology presets for early war, pod warfare, early Apollo deployment, and the later Grand Alliance.

## 2. Astrography & Astrophysics: The Manticore Binary System & Hyperspace Architecture

### 2.1 Stellar framework

**W:** Manticore is a distant binary about 512 light-years from Sol. A is a G0 star of 1.12 solar masses; B is a G2 companion of 0.92 solar masses. The wiki gives barycentric distances of 333 LM and 406 LM and separation extrema of 650–827 LM, with approximately 12% eccentricity. The system's inhabited worlds are Manticore and Sphinx around A, and Gryphon around B. [4]

| Parameter | Value used here | Status |
| --- | --- | --- |
| A–B nominal separation | 739 LM ≈ 13,292.80 Mkm ≈ 12.317 LH | W inputs, D sum/conversion |
| Periastron / apastron separation | 650 / 827 LM ≈ 11,692 / 14,876 Mkm | W, rounded D conversions |
| Manticore-A hyper limit | 22 LM ≈ 395.726 Mkm | P: *On Basilisk Station*, Ch. 5 [8] |
| Manticore-B hyper limit | Draft's 22.12 LM retained only in Appendix A | S: not independently established here |
| A–B direction at battle epoch | Not established by separation data | S: scenario input |

**D consistency note:** barycentric distances 333 and 406 LM imply a mass ratio of approximately 1.219; 1.12/0.92 gives approximately 1.217. This is consistent within rounding. The midpoint of 650 and 827 is 738.5 LM; the nominal 739 LM should not be treated as an exact ephemeris.

### 2.2 Planetary identities and physical properties

The corrected order of the outer A-system planets is **Draco A-V, Roc A-VI, Wyvern A-VII**. Draco and Roc are gas giants, rather than the terrestrial Roc listed in the draft. Phoenix is A-II; the retrieved sources do not establish “Phoenix” as a name for the B star. The following table intentionally avoids certifying the draft's full set of orbital radii. [4, 5]

| Body | Identity / physical information | Orbit / position treatment |
| --- | --- | --- |
| Salamander | A-I; small, moonless world | Wiki gives approximately 1.75 LM [6] |
| Phoenix | A-II | Exact orbit and draft's “habitable” designation remain unverified |
| Manticore | A-III; capital Landing; diameter 12,992 km; 1.01 g; moon Thorson | Wiki gives year 1.73 T-years and day 22.45 T-hours; no verified Cartesian position [7] |
| Sphinx | A-IV; treecat homeworld; diameter 13,906 km; 1.35 g | Wiki gives year 5.22 T-years; inherited 15.30 LM is a provisional scenario value [9] |
| Draco | A-V; gas giant | Exact orbit not verified in this revision |
| Roc | A-VI; gas giant | Exact orbit not verified in this revision |
| Wyvern | A-VII; gas giant | Exact orbit not verified in this revision |
| Gryphon | B-V; B's inhabited world | Draft radius, gravity, and 18.20 LM orbit require verification |
| Unicorn Belt | B-system asteroid belt | Keep belt identity separate from an unverified radial boundary |

**D cross-check, not replacement canon:** Kepler's relation, \(P^2\simeq a^3/M_\star\), with years, AU, and solar masses, implies approximately 1.50 AU / 12.45 LM for Manticore if its 1.73-year period and A's mass are used. The equivalent estimate for Sphinx's 5.22-year period is approximately 3.13 AU / 26.0 LM. The latter is inconsistent with a circular 15.30 LM orbit, which would instead imply about 2.36 years. Do not silently replace a selected battle map with these derived values: retain the conflict and identify the source edition or scenario reconstruction before resolving it.

### 2.3 Infrastructure is an object with a lifecycle

**W:** Hephaestus is an orbital station above Manticore. [10] The draft associates Vulcan with Sphinx and Weyland with Gryphon; those station associations are retained as provisional until individually sourced. Station positions require their own planetary orbital state or local offset.

For simulation purposes, each installation should track position, civilian presence, industrial function, sensors, defensive batteries, ammunition, and operational state. A yard is not automatically a fully armed fortress. Later destruction of orbital industry must not be applied to an earlier battle preset.

### 2.4 Junction geography and connectivity

**W:** the Manticore Junction's central node is described as an invisible sphere about one LS in diameter, approximately seven LH from A, with seven external termini known in the 1921 PD context. The Junction article dates the Lynx survey/discovery to 1919 PD; the draft's 1918 date is not used as the verified default. [11]

| External terminus | Regional connection |
| --- | --- |
| Beowulf | Sigma Draconis / Solarian region |
| Trevor's Star | San Martin / Haven-sector route |
| Hennesy | Phoenix Cluster |
| Gregor | Andermani-region route; governance is more nuanced than a single ownership label |
| Matapan | Matapan system route |
| Basilisk | Basilisk system / northern route |
| Lynx | Talbott connection |

**S:** preserve 412 LM from A and approximately 660 LM from B as inherited map parameters if needed, but the retrieved “seven LH” description does not certify those exact values. Also distinguish **seven external termini** from a count including the central node. These are alternate counting conventions, not necessarily an eighth external destination.

**P:** traffic goes from a secondary terminus to the central node, or from the central node to a secondary. It cannot move directly between two secondary termini in one passage. A graph model should therefore route through the central node. [8]

### 2.5 Transit mass, cooldown, and approach state

**P:** Manticore's simultaneous transit ceiling is approximately 200 million tonnes. *On Basilisk Station* gives a 4-million-tonne transit window of about 25 seconds and a 200-million-tonne assault window of over 17 hours. The destabilization belongs to the particular terminus-to-terminus route, rather than automatically closing every route in the Junction. [8]

**D approximation:** a coefficient inferred from the 4-million-tonne example is

\[
k\simeq\frac{25}{(4\times10^6)^2}=1.5625\times10^{-12}\ \mathrm{s/tonne^2}.
\]

Then \(T=kM^2\) predicts 62,500 seconds / 17.36 hours at 200 million tonnes. This is a useful calibration, not a complete law for every small transit or junction. A minimum lockout and route-specific overrides remain configurable.

**D:** at 8,768,500 tonnes each, 22 Invictus hulls total 192.907 million tonnes, while 23 total 201.6755 million. Thus “22–25 pod superdreadnoughts” is not a valid universal capacity: this particular hull mass permits at most 22, before adding any other transiting mass.

**S model:** require an approach solution, transit clearance or military priority, sail configuration, legal aggregate mass, and a clear route. Sails-to-wedge transition and defensive readiness after emergence should be explicit events.

### 2.6 Resonance zones and hyper limits

**P:** the original novel describes a roughly conical interference volume between a terminus and its associated star, lethal in the lowest hyper bands. It is not a perfect cone: it has spurs and, in a binary, interacting danger volumes. Clear approaches exist around portions of the outer perimeter. A terminus also has a local hyper limit, described there as less than one million km. [8]

The later publisher-hosted *A Call to Insurrection* excerpt describes hazards affecting A and B differently, including translation scatter and node wear, and notes that mapped regions can shift. Its historical context should not be substituted wholesale into a 1921 PD scenario. [12]

**S consequence:** remove the draft's universal assertion that every hyper translation anywhere inside a fixed cone instantly destroys the ship. Model stellar exclusion, terminus exclusion, resonance hazards, and permitted approaches separately. An exact 44 LM base width and “Sphinx 102 Mkm inside the cone” are unsupported here: a radial distance alone cannot establish membership in a directional volume.

## 3. Drive Engineering & Hyperspace Mechanics

### 3.1 Impeller drive and wedge geometry

**W:** fore and aft drive rings generate dorsal and ventral stress planes. The forward throat is deeper than the aft kilt. Military drives use double stress bands. The wedge blocks known weapons, while the broadside, throat, and kilt provide attack aspects. Intersecting wedges can damage drive nodes; a much stronger wedge can survive interaction with a weaker one. Alpha nodes can reconfigure for sails; beta nodes support the wedge, with beta-squared nodes used in advanced LACs. [13]

**S geometric model:** represent the two stress bands as separate finite surfaces in the ship's local frame. Put sidewalls between their edges and leave the intended end apertures. Keep hull length, wedge footprint, and displayed symbol size independent. A kilometer-scale hull does not imply a kilometer-scale wedge.

Ray tests must determine whether a weapon path intersects a stress plane before evaluating hull damage. For a missile, test both the missile's moving wedge volume and the laserhead's outgoing beam directions. “Target is inside missile range” is insufficient to establish a valid shot.

### 3.2 Compensators, acceleration limits, and failure

**W:** inertial compensators use the wedge as an inertial sump. Their effectiveness depends on enclosed volume and sump strength; their failure at high acceleration is lethal to occupants and delicate equipment. Ordinary gravity generation provides only a much smaller acceleration offset. [14]

**S model:** treat operational acceleration as the minimum of drive capacity, compensator capacity, damage limits, and selected safety setting. A published “80% acceleration” is an operating margin, not 80% of light speed. The same hull can gain performance after a compensator refit without changing its exterior model.

Keep `maximum_acceleration`, `normal_acceleration`, `available_acceleration_after_damage`, and `commanded_acceleration` as separate values. Do not assume that a surviving but damaged ship can keep formation with undamaged companions.

### 3.3 Warshawski sails and the difference between propulsion and translation

**W:** sails are fields at the bow and stern perpendicular to the ship's axis, extending hundreds of kilometers. They allow safe interaction with hyperspace gravity waves and can draw power from those waves. The handled energy can appear auroral; the field itself is not a solid luminous sheet. [15]

A hyper generator provides translation; sails and impellers supply propulsion under the relevant conditions. Impellers work in hyper away from gravity waves. [13]

**S:** the draft's 150–500 km sail diameters and 5,500 g wave acceleration are retained as provisional ranges, not universal class-independent constants. Available wave power, route, band, compensator, and operating practice matter.

### 3.4 Hyperspace bands and effective velocity

**P:** Weber's 2002 band table gives the following multipliers and representative apparent velocities. These are dated background values, not an assertion that every ship can safely reach every listed band. [16]

| Band | Velocity multiplier | Warship apparent speed at local 0.6c |
| --- | ---: | ---: |
| Alpha | 62 | 37.2c |
| Beta | 767 | 460.2c |
| Gamma | 1,473 | 883.8c |
| Delta | 2,178 | 1,306.8c |
| Epsilon | 2,884 | 1,730.4c |
| Zeta | 3,589 | 2,153.4c |
| Eta | 4,294 | 2,576.4c |
| Theta | 5,000 | 3,000c |

The same table lists Iota's multiplier as 6,000 but labels it unattainable at that time. Translation bleeds off velocity; effective speed is not a simple continuously escalating throttle. A route's average speed is lower than its best cruise speed because of acceleration, translation, routing, and approach time.

**W:** band boundaries present hazards, and the later streak drive changes the accessible upper bands. [17, 18] Avoid the draft's description of all successive multipliers as exponential: the published table does not support it. The draft's 0.30c translation ceiling and 0.23c “standard” are not validated here; retain them only as explicit provisional scenario settings.

### 3.5 Hyper-generator readiness

**P:** Weber distinguishes powered down, routine readiness, standby, and translation. If the final cycle is \(C\), the successive preparation stages require approximately \(4C\), \(3C\), and \(C\), totaling \(8C\) from powered down. [19]

**W examples:** a small military vessel has a minimum cycle around 30 seconds; a representative 8-million-tonne SD requires 240 seconds from standby and 32 minutes from powered down. The wiki gives 44.6 seconds for a Saganami-C and 118.8 seconds for a David Taylor support vessel. [20]

**S:** use readiness state, transition recovery, astrogation time, and ship-specific cycle overrides. A ship beyond the hyper limit is not necessarily able to escape immediately. Do not derive an exact mass-to-cycle formula from these few examples.

### 3.6 Spider and streak drives

**W:** spider drives pull against the alpha wall using exceptionally powerful tractor/pressor arrangements. They lack a normal impeller wedge, its usual signature, and its inertial sump. Approximately 200 g performance, grav-plate compensation, trilateral symmetry, and transverse decks distinguish them from conventional warships. A cautious, distant hyper emergence still creates a footprint. Stealth does not mean physical invisibility or guaranteed immunity to all sensors. [18]

**W:** streak drives use larger hyper generators to reach Iota and Kappa, shortening interstellar journeys. This is a hyper-access advantage, not a normal-space stealth or tactical acceleration capability. [21]

**S:** discard an automatic one-LS spider detection boundary. Detection depends on sensor type, geometry, emissions, background, and search coverage. The detailed 150–210 g / 310 g emergency / felt-g limits in the draft remain provisional until supported by a specific passage.

## 4. Ordnance, Weapon Systems & Defense Platforms

### 4.1 Distinguish missile models, modes, and generations

**W reference data:** [22]

| Weapon | Role / reported parameter |
| --- | --- |
| Mark 16 DDM | Two drive stages; used by smaller combatants; distinguish from an older single-drive Mark 16 |
| Mark 23 MDM | Three stages; capital weapon; reported mass 94 tonnes |
| Mark 23 drive settings | 96,000 g maximum / 48,000 g half setting; wiki reports about 63 Mkm and 0.83c for the long profile |
| Mark 25 | Four-stage system-defense missile |
| Mark 23-E / F | Apollo control variants for ship / system-defense applications |
| Mark 31 CM | 130,000 g; 75-second endurance; approximately 3.6 Mkm from rest |
| Mark 9 Viper | Anti-LAC weapon using Mark 31 drive characteristics; also usable as a CM |
| Mark 16 Mod G warhead | Reported 40-megaton fusion source, versus 15 megatons for earlier Mod E variants |

Model labels alone are insufficient: warhead mod, launch mechanism, motor profile, and telemetry architecture must also be specified. The draft's combined Mk16/Mk23 performance envelope is replaced by these distinctions.

### 4.2 Launch, powered flight, and ballistic intervals

**W:** modern tubes impart launch velocity with mass drivers; conventional examples include roughly 46,000 g for 180 seconds. Pods are expendable, cannot be reloaded in battle, can suffer proximity kills, and may impose a towing penalty outside the wedge. Conventional Mk17 flatpacks carry ten Mk23 missiles; the Apollo layout reduces attack-missile count to eight to accommodate its controller. [23]

**S sequence:** tube or pod release → clear ship/wedge hazards → drive ignition → powered stage → optional coast → subsequent stage → terminal acquisition → defensive engagements → laserhead attack or failure. A missile can coast without instantly disappearing, but its remaining ability to maneuver and obtain a terminal solution is decisive.

Launching from a moving ship changes the reachable envelope. A closing target and a retreating target do not have the same effective engagement range. Compute a trajectory or intercept condition, not merely a fixed circle around the firing ship.

### 4.3 Pods, salvo density, and Apollo packaging

**W:** an Apollo pod groups eight attack/EW missiles with one larger, unarmed Mark 23-E control missile. Keyhole II enables the FTL control architecture. [24]

**D:** for \(N_p\) such pods, count \(8N_p\) attack/EW vehicles and \(N_p\) controllers. EW vehicles consume attack positions; they are not free additional warheads. A nominal wave of 100 pods therefore contains 800 attack/EW vehicles plus 100 controllers, with fewer than 800 damaging laserheads if some positions hold penetration aids.

**D correction:** Invictus's 1,074-pod magazine is a pod count. It corresponds to 10,740 missile positions under a ten-Mk23 load, or 8,592 attack/EW positions plus 1,074 controllers under an all-Apollo load. The draft's 12,888 assumes twelve per pod and should not be used without a separately identified pod type.

**S:** maintain pod model, load composition, ejection interval, external pod inventory, controller assignments, and reachable launch aspects. Missile depletion, destroyed rails, and loss of usable control channels can reduce salvo size independently.

### 4.4 Laserheads, lasers, grasers, and energy torpedoes

**W:** laserheads turn a fusion detonation into directed X-ray attack beams. Older descriptions use approximately 25 beams, while specific missile generations use different arrangements. Treat the draft's “10–50 rods” as a descriptive range rather than the specification of every laserhead. [25]

**P:** Weber explains why laserheads outperform contact attacks against defended ships: they can attack across a larger terminal basket and exploit brief exposed aspects without forcing the entire missile body through a narrow gap. His FAQ quotes approximately 0.81c for a Mk23 nine-minute run; this differs from the wiki's 0.83c figure and should not be silently merged. [19]

**W:** direct lasers and grasers use gravitic focusing. A setting-scale reference gives approximately one million km against an unshielded target and substantially less against sidewalls; these are broad envelopes, not universal damage thresholds. [25] Energy torpedoes are projected plasma weapons, with reported reach around 300,000 km, and are stopped by sidewalls. [26]

**S:** retain laserhead standoff and beam count per warhead mod. The draft's 30,000–40,000 km standoff and petawatt-to-exawatt output are not validated as universal values. Resolve energy shots at light speed. A drawn visible beam is a display aid; X-rays and gamma rays do not produce an ordinary glowing line in empty space.

### 4.5 Grav lance and Crippler

**W:** a grav lance disrupts a target's sidewall by disturbing wedge alignment. Its optimal maximum range is approximately 100,000 km, it is very large, and it demands most of the firing ship's power. The Crippler instead induces drive resonance; military double stress bands defeat the mechanism described for attacking merchant wedges. [26]

The draft's million-kilometer “advanced grav lance” is not retained as an established upgrade. These weapons should have distinct target eligibility, range, power, and recovery conditions.

### 4.6 Passive protection

**W:** sidewalls protect broadside openings, while the wedge protects dorsal and ventral aspects. Broadly reported energy ranges fall around 400,000–500,000 km against sidewalls, depending on weapon and protection. Bow/stern walls address exposed ends; a complete end closure interferes with acceleration, while buckler designs permit partial protection. [27, 13]

**S damage rule:** sidewalls are geometric and directional; do not model them as a universal shield-health sphere. Evaluate incidence angle, weapon focusing and generation, penetrators, local wall damage, and hull armor. A bow wall is not “complete forward immunity”: it remains a sidewall-grade barrier, with its own penetration limits.

The draft's 10 km sidewall offset is supported as an example in Weber's FAQ, not a scale-independent hull rule. [19] Particle and radiation protection is a separate subsystem from battle shielding. Keep high-speed environmental limits and combat penetration separate; retain the draft's 0.80c ship limit as a configurable setting rather than applying it identically to missiles, ships, and hyper travel.

### 4.7 Active defense and saturation

**W:** counter-missiles principally kill by wedge interaction. Point-defense lasers must strike an exposed missile aspect. [23, 27] Keyhole coordinates multiple CM waves around wedge interference; Keyhole II also links Apollo. [26]

**S layered model:** detect and classify → assign defensive channels → launch one or more CM waves → assess surviving tracks → engage with PD lasers → maneuver passive protection → resolve surviving laserheads. Use uncertain tracks rather than granting every defender perfect knowledge of every real warhead.

The draft's fourteen emitters, sixteen-second emitter cycle, and 150,000 km PD range remain provisional class/era parameters. If a cluster has \(n\) independently scheduled emitters with cycle \(\tau\), its ideal average throughput is \(n/\tau\). This does not mean all emitters can see, target, or hit the same incoming missile.

**D illustration:** a 0.8c approach crosses 150,000 km in approximately 0.625 seconds. The interval from 150,000 km to a 40,000 km standoff point is approximately 0.459 seconds for a stationary target and constant approach speed. Therefore pretracking, multiple ready emitters, and aim prediction dominate the last defensive window. Neither radius is certified here; the arithmetic shows why arbitrary arcade timing is misleading.

### 4.8 Mesan graser torpedoes and later ordnance

**W:** a graser torpedo is an autonomous spider-driven platform with a single-shot cruiser graser. Its approximately three-second beam differs from millisecond laserhead flashes; it was used in Operation Oyster Bay in 1922 PD. It is large, stealthy, and trilaterally symmetric. [28]

**W later developments:** Cataphracts combine a shipkiller with an additional CM-derived drive; the later Lorica is a large pod-launched multi-drive CM reported to reach 35 Mkm. Neither should be assigned to every earlier Mesan or Solarian force. [29]

**S:** remove the fixed 50,000 km graser-torpedo sidewall penetration envelope until separately sourced. Its prolonged beam should be an exposure event with duration and target motion, rather than simply a standard missile explosion multiplied by a fixed factor.

## 5. Ship Classes & Hardpoint Specifications

### 5.1 Conventions

**M** = attack-missile tube; **G** = graser; **L** = laser; **ET** = energy torpedo; **CM** = counter-missile tube; **PD** = laser cluster; **MP** = pod-ejection lane.

**Broadside figures below are per side.** Where a source groups chase weapons without distinguishing ends, preserve that uncertainty. Do not multiply a per-side total twice, or place a whole-ship count on both sides. Counts establish capacity, not exact exterior coordinates; actual mount placement still requires a drawing or an **S** distribution.

### 5.2 Invictus SD(P)

**W:** [30]

| Item | Specification |
| --- | --- |
| Introduction | 1919 PD |
| Mass | 8,768,500 tonnes |
| Hull L × B × H | 1,394 × 202 × 188 m |
| Maximum / normal acceleration | 562.6 / approximately 450.1 g |
| Each broadside | 18 G, 84 CM, 62 PD |
| Fore | 10 G, 24 CM, 22 PD |
| Aft | 6 MP, 10 G, 14 CM, 24 PD |
| Pod stowage | 1,074 pods |
| Ejection cycle | Six pods per twelve seconds |

No broadside attack-missile tubes are fitted. Apollo capability must be checked by ship: the wiki specifically distinguishes the lead ship's Keyhole equipment from the remaining class. Do not assign every hull two Keyhole II platforms solely from its class name.

**D derived capacity:** continuous ejection at the listed rate exhausts 1,074 pods in approximately 35.8 minutes, excluding predeployed loads and interruptions. A twelve-second Apollo packet contains 48 attack/EW vehicles plus six controllers before aggregation into larger salvos.

### 5.3 Nike BC / BC(L)

**W:** [31]

| Item | Specification |
| --- | --- |
| Mass | 2,519,750 tonnes |
| Hull L × B × H | 1,012 × 129 × 114 m |
| Maximum / normal acceleration | 674.3 / approximately 539.4 g |
| Each broadside | 25 M, 12 G, 32 CM, 30 PD |
| Chase entry | 4 G, 12 PD; confirm interpretation per end against a detailed drawing |
| Magazine | 6,000 Mk16 DDM |
| Crew | 750 |

Nike is a conventional large battlecruiser, not a BC(P). Its fifty missile tubes are the total of two broadsides; the draft's “32 broadside grasers” is not the retrieved per-side count. Off-bore missile engagement and heavier protection distinguish it from older battlecruisers. Do not infer a forty-minute magazine duration without specifying a launch cycle.

### 5.4 Edward Saganami-C CA

**W:** [32]

| Item | Specification |
| --- | --- |
| Introduction | 1920 PD |
| Mass | 483,000 tonnes |
| Hull L × B × H | 610 × 74 × 62 m |
| Maximum / normal acceleration | 726.2 / approximately 580.9 g |
| Each broadside | 20 M, 8 G, 20 CM, 24 PD |
| Chase entry | 3 L, 2 G, 8 PD |
| Internal magazine | 1,200 Mk16 DDM |
| External load | Reported provision for forty Mk23 flatpack pods |
| Crew | 355, including 140 Marines |

Forty missiles is the combined tube count. The article describes forty-missile salvos every eighteen seconds using off-bore arcs. Its listed 80% acceleration in km/s² contains an arithmetic inconsistency: 580.9g converts to about **5.697 km/s²**, not 5.607. This report retains g as the input and derives the conversion.

The draft's “128 Apollo telemetry links” was not validated. Ordinary missile-control capacity and full Apollo/Keyhole II functionality must not be conflated.

**D magazine illustration:** 1,200 missiles at forty per eighteen seconds lasts approximately nine minutes, before external pods, EW allocation, or altered firing doctrine.

### 5.5 Shrike-B LAC

**W:** mass 21,250 tonnes; hull 72 × 20 × 20 m; approximately 635 g maximum and 508.4 g normal acceleration. Forward armament is 4 M, 1 G, 4 CM, and 6 PD; aft is 4 CM and 6 PD. Magazines hold twenty attack missiles and one hundred CMs. The graser aperture is 1.5 m. New construction from 1915 added stern-wall equipment, but the source notes insufficient power to run bow and stern walls together. [33]

**S:** retain the draft's fission-plant model and eighteen-year core life as unverified detail. The combat model should prioritize endwall power allocation, limited ammunition, and the forward graser's firing aspect.

### 5.6 Katana space-superiority LAC

**W:** Katana is a Grayson/RMN design for anti-LAC combat and fleet missile defense. It carries five multipurpose off-bore launchers for Mk31 CMs or Mk9 Vipers, three heavy PD clusters forward, and light PD protection aft. A two-phase bow buckler and improved EW support its role. It does not carry conventional large anti-shipping missiles. [34]

The draft's exact 19,500-tonne mass, 71 m length, 640.4g acceleration, and six aft clusters remain provisional; those numbers were not present in the retrieved article text. Keep them available as optional modeling inputs with an **S** label.

### 5.7 Added comparison classes

| Class | Mass / propulsion reference | Useful technical distinction | Source |
| --- | --- | --- | --- |
| Agamemnon BC(P) | 1,750,750 tonnes; 815 × 118 × 110 m; normal 554.1g | 360 pods; four ejection lanes; typical fourteen-Mk16 load; per broadside 10 G, 30 CM, 30 PD | W [35] |
| Sovereign of Space SD(P) | 8,750,000 tonnes; listed acceleration 529g, setting not established here | Havenite pod-layer; six pods per twelve seconds; no broadside attack tubes | W [36] |
| Honor Harrington II SD(P) | Detailed dimensions not established here | Grayson retains internal broadside tubes at the expense of pod volume; do not copy Invictus's layout | W [37] |
| Covington CLAC | 6,244,250 tonnes; 1,135 × 189 × 175 m; 476.7g maximum / 381.4g normal | 124 LAC bays; logistics and recoverability matter as much as its defensive armament | W [38] |
| Gryphon conventional SD | 8,339,000 tonnes; 1,371 × 199 × 185 m; listed 402.1g | Per broadside: 37 M, 19 L, 22 G, 8 ET, 28 CM, 30 PD; earlier mixed-armament architecture | W [39] |
| Cimeterre LAC | Crew 13–15; reported 96-hour endurance | Original design prioritizes fleet defense; Alpha and Beta variants add different power, wall, and weapon packages | W [40] |

### 5.8 Hull and subsystem modeling

**S recommendations:** conventional hulls should separate hammerheads, drive rings, broadside armor, sensor apertures, boat bays, and pod-core doors. Do not place dorsal guns that must fire through the ship's own wedge. Spider-driven hulls require a different layout rather than reskinning a conventional hammerhead.

Use subsystem damage states: drive rings, compensator, power distribution, port/starboard wall generators, chase defenses, fire control, magazines, pod rails, and command spaces. A single percentage of hull health cannot reproduce a ship that still has intact armor but cannot accelerate, steer its missiles, or close a vulnerable aspect.

## 6. Tactical Engagements & Maneuvering Dynamics

### 6.1 Orientation, aspect, and formations

The throat and kilt matter because they open between the stress bands; conventional broadside tactics seek firing opportunities through these exposed aspects. A defensive roll presents a stress plane to the threat. [13, 19]

**S:** represent the vessel's orientation independently of its velocity. Turning the bow does not instantaneously redirect momentum. A ship can roll while continuing on its original trajectory; a formation can reverse acceleration while still moving toward the enemy.

Replace the draft's universal 10–20 km capital-ship spacing. The wedge is much larger than the hull, so collision clearance must be calculated from the modeled stress-band volumes and permitted maneuvers. A formation should remain safe during acceleration, roll, and course changes, not only when icons are at rest.

A “wall” is a three-dimensional tactical arrangement optimized for firing aspects and coordinated defense. Its displayed symbols may be compressed, but its physical members must not occupy a single narrow strip that forces their wedges to overlap.

### 6.2 Rolling is a tradeoff

**S interpretation of the cited geometry:** rolling protects some attack paths while restricting broadside sensors and weapons. It does not guarantee that every missile from every direction hits the wedge. Track separate threat sectors, aperture visibility, endwall state, and external platforms. Overlapping salvos can attack different exposed angles.

Damage during a roll depends on where surviving warheads arrive, not merely whether the ship's roll angle crossed ninety degrees. Keyhole and drone survival can preserve defensive awareness when the hull itself has a poor line of sight.

### 6.3 Salvo timing and defensive concentration

**S:** distinguish missile launch time, arrival time, terminal attack time, and beam impact time. Consecutive launched waves can merge into one arrival packet through drive programming. A large salvo can overload control channels, ready PD emitters, and magazine throughput even when defenders have ample total ammunition.

Model defense as scheduled assignments rather than a constant percentage removed from every salvo. Test local coverage and which ships can help each other. Destroying a nearby controller, rolling a protecting ship, or damaging one broadside can leave a temporary gap.

## 7. Sensors, Communications & Electronic Warfare

### 7.1 Actual position is different from observed position

**W:** gravitic sensors detect wedges and hyper phenomena through a faster-than-light propagation mechanism. They do not make every optical image, radar echo, or warhead observation instantaneous. Conventional radar/lidar and remote observations remain distinct sources. [41]

**S:** each contact should carry observation timestamp, receipt timestamp, sensor origin, sensor type, identification confidence, and uncertainty. Store a predicted track separately from ground truth. A remote drone sees the target from the drone's location; a fast return link does not remove the target-to-drone optical delay.

### 7.2 Propagation and refresh rates

**S:** the draft's 64c grav-pulse speed can be used as a declared propagation preset. This exact coefficient was not independently verified in the retrieved material. The following derived table therefore compares light speed with that assumed preset; it is not a new universal canon assertion.

| Separation | Light-speed one-way delay | At assumed 64c, one-way |
| --- | ---: | ---: |
| 1 LM | 60 s | 0.938 s |
| 22 LM | 1,320 s | 20.625 s |
| 70 Mkm | 233.495 s | 3.648 s |
| 412 LM | 24,720 s / 6.867 h | 386.25 s / 6.438 min |

For active sensing, include an outbound and return leg. For a control loop, include observation, transmission, processing, command transmission, and actuator response. “Effectively real time” is relative to a tactical problem, not literal zero latency.

**W:** early FTL recon drones had a cited pulse repetition time of 9.5 seconds. This is an era-specific refresh limitation, not the speed at which a pulse travels. [42] Treat bandwidth, refresh rate, and propagation speed as separate properties.

### 7.3 Ghost Rider, Keyhole, and Apollo

**W:** Ghost Rider is an umbrella development program covering improved seekers, drones, decoys, MDM developments, Dazzlers, and Dragon's Teeth; it is not synonymous with one Keyhole platform. [43]

**W:** Keyhole's defensive role and Keyhole II's Apollo role are distinct. [26] Associated missiles can continue on their last instructions after an Apollo controller is lost. [22]

**S:** represent the network as operational nodes and links. Destroying a controller should change guidance quality or update frequency, rather than automatically killing every missile. External pods under a cruiser may use ordinary telemetry even if their missile model is also compatible with an Apollo-capable capital ship.

### 7.4 EW and deception

**W:** Dazzlers jam defensive sensors; Dragon's Teeth create apparent missile volleys that attract CM effort. They should not be described as universally generating full starship signatures. [22] Triple Ripple uses three nuclear waves to damage or obscure remote platforms and confuse fire control; it is associated with Havenite LAC tactics. [40]

**S:** keep real vehicles, apparent tracks, jamming strength, classification confidence, and defensive assignments separate. Jamming may reduce lock quality without making all contacts disappear. Decoys should burden the opponent's targeting process; they should not create extra physical missiles or extra kinetic damage.

### 7.5 System-defense control networks

**W:** Moriarty coordinates Havenite system-defense fire; the later Mycroft concept distributes modified, self-powered Keyhole II platforms and supports Grand Alliance defense. The Mycroft article dates operational deployment in Manticore, Haven, and Beowulf to late 1922 PD. [44, 45]

**S:** do not insert that later network into the 1921 battle merely because it fits the simulation's needs. Represent orbital pods, their controlling stations, and local fallback behavior separately. A control platform's loss can change the effectiveness of many physically intact launchers.

## 8. Kinematics & Numerical Implementation

All equations in this section are **D calculations** or **S implementation guidance**, not fictional engineering laws.

### 8.1 Basic integration

For a short interval with constant coordinate acceleration:

\[
\mathbf{x}_{t+\Delta t}=\mathbf{x}_t+\mathbf{v}_t\Delta t+\tfrac12\mathbf{a}_t\Delta t^2,
\qquad
\mathbf{v}_{t+\Delta t}=\mathbf{v}_t+\mathbf{a}_t\Delta t.
\]

Use these equations for an explicitly classical tactical approximation. They cease to be a faithful physical model at high fractions of c. Do not allow a long frame step to push a missile past its target, through a wedge, or above c.

An event-driven model should split intervals at ignition, burnout, stage change, intercept, detection, endwall activation, roll completion, detonation, and beam impact. Use swept intersection tests rather than relying on whether two objects happen to share a rendered frame.

### 8.2 Missile endurance example

Using the illustrative conventional profile from Section 4.2, \(a=46,000g_0=451.1059\) km/s² and \(t=180\) s:

\[
v=at\simeq81,199\ \mathrm{km/s}\simeq0.271c,
\qquad d=\tfrac12at^2\simeq7.308\ \mathrm{Mkm}.
\]

This is a from-rest classical result, consistent with the article's broad “over six million km” description. It is not a complete attack solution against a moving target.

If a modeling preset changes acceleration or powered lifetime, recalculate both velocity and range. Do not combine one source's terminal velocity with another source's motor duration without a reconciliation note.

### 8.3 Relativistic treatment

For collinear velocities, use

\[
u=\frac{u'+v}{1+u'v/c^2}
\]

when transforming missile motion between the launcher's frame and the system frame. A full implementation requires vector transformations for off-axis launches. Missile terminal velocity relative to its launch platform is not necessarily its system-frame velocity or the closure speed seen by a defender.

For physical constant proper acceleration \(\alpha\), from rest:

\[
v(t)=\frac{\alpha t}{\sqrt{1+(\alpha t/c)^2}},\qquad
x(t)=\frac{c^2}{\alpha}\left[\sqrt{1+(\alpha t/c)^2}-1\right].
\]

Fictional drive figures do not always map cleanly onto this treatment. Offer two declared modes if necessary: **narrative-calibrated** motion matching sourced engagement profiles, and **relativistic** motion with a specified frame and acceleration convention. Never imply that switching between these modes leaves missile ranges unchanged.

### 8.4 Roll and turn resolution

Integrate orientation with quaternions or another consistent three-dimensional representation. Ship yaw, pitch, and roll change facing; acceleration changes velocity. Separate reaction-thruster turning, drive-vector commands, angular-rate limits, and available maneuver time. The same distinction applies to a missile's attitude and its actual flight path.

### 8.5 Numerical scale

Maintain physical coordinates in high-precision simulation state and use a local render origin near the camera or selected formation. A 13-billion-km binary displayed alongside a 20 m LAC cannot be represented usefully at one literal icon scale.

Use explicit modes: system overview, engagement view, and ship detail. Preserve physical ranges and timestamps while changing rendered symbol sizes. Show when hulls, wedge outlines, and missile swarms are enlarged for readability.

## 9. Damage, Survival & Logistics

### 9.1 Damage progression

**S:** resolve an attack through a sequence of eligibility tests: sensor solution → guidance → surviving defenses → valid beam aspect → sidewall/penetrator outcome → armor → subsystem damage. If these stages are abstracted into probabilities, retain their separate causes in the event log.

Do not equate every hit with a kill. Outcomes include loss of a drive ring, reduced acceleration, isolated wall failure, loss of chase defenses, magazine damage, pod-core interruption, command loss, and compensator failure. Conversely, a compensator casualty can leave an outwardly intact but dead vessel.

### 9.2 Magazines and sustainment

**S:** record offensive missiles, EW payloads, Apollo controllers, pods, CMs, and available launch cycles independently. Predeployed pods remain physical assets with owners/controllers. When a fleet arrives after resupply, reset only the inventory actually restored.

LAC operations require carrier launch, rendezvous, recovery, rearming, and maintenance. A CLAC's nominal bay count is not a guarantee that every craft is serviceable or present. A damaged carrier can force intact LACs to divert or be abandoned.

### 9.3 Operational scale

**P:** the Baen-published analysis by BuNine-associated authors explains why bases and resupply constrain operations despite hyperspace allowing forces to bypass intervening systems. Manticore's concentrated industry and the Junction's mobility/economic role create different strategic dependencies. [46]

**S consequence:** a campaign layer needs travel time, ammunition consumption, repair capacity, and communication arrival. Ship counts alone cannot explain why a fleet is unable to exploit an apparently successful battle.

## 10. Battle of Manticore: Calibration & Scenario Boundaries

### 10.1 Distinguish the battle from Eighth Fleet

**W:** the 1921 PD engagement is the Battle of Manticore / Operation Beatrice. “Eighth” identifies Harrington's Eighth Fleet; “Eighth Battle of Manticore” is not established by the retrieved battle article as the event's canonical name. Retain it only as a project or reconstruction title if intended. [47]

### 10.2 A useful salvo arithmetic check

**W:** the wiki describes Eighth Fleet deploying 5,000 pods before Junction transit, adding 2,776, and launching 62,208 attack/EW missiles with 7,776 Apollo controllers. It places the attack at approximately 78 Mkm from Fifth Fleet. [47]

**D:** \(5,000+2,776=7,776\); \(7,776\times8=62,208\); total vehicles including controllers are 69,984. These are three different counts and must remain distinct. Do not render 69,984 damaging warheads.

**S:** this is a calibration checkpoint, not a complete battle ephemeris. The retrieved account does not establish every ship's coordinates, course change, launch timestamp, or defensive assignment. Reconstructed values require labels and an explicit event sequence. The 78 Mkm separation also illustrates why ballistic intervals, inherited velocity, and accurate fire control matter beyond a simplified from-rest powered-range circle.

### 10.3 Capability boundaries

For a 1921 preset, keep Apollo-equipped units distinct from earlier pod combatants and ordinary tube ships. Later Oyster Bay weapons and Mycroft deployments belong to separate scenarios. Avoid giving Haven Solarian-era limitations simply because both oppose Manticore; the RHN possesses its own advanced pod and defense capabilities. [28, 36, 45]

## 11. Tactical Display & Visual Effects Specification

All recommendations in this section are **S**, unless explicitly tied to a cited capability.

### 11.1 Display layers

| Layer | Required distinction |
| --- | --- |
| Celestial map | Bodies, parent stars, orbit data, epoch, hyper limits |
| Ground truth | Actual fleet positions and events; available in observer/replay mode |
| Commander picture | Delayed detections, predicted tracks, unknown identities, uncertainty |
| Engagement | Launch packets, drive phases, intercepts, terminal windows |
| Protection | Wedge faces, walls, exposed aspects, defensive sectors |
| Communications | Active control links, relay status, update age |
| Damage | Lost nodes, degraded acceleration, unavailable launchers/controllers |

An interactive replay should let the user switch between actual and perceived positions. This makes tactical surprise understandable without moving an enemy arbitrarily for dramatic effect.

### 11.2 Effects grounded in the mechanics

Use wedge distortion and symbolic field outlines; cyan/magenta sheets are an artistic palette, not a verified natural optical signature. The draft's universal 100 km field offset and \(>100,000\) m/s² gradient are not validated.

Show hyper or Junction emergence as a brief transit-energy event and field reconfiguration, consistent with the described sail flash. [8] Missile motor stages should be identifiable; an impeller-driven missile need not leave a rocket exhaust plume.

Laserhead attacks should appear as near-target flashes with brief indicated attack vectors. Graser torpedoes need a visibly longer attack interval. CM kills indicate wedge interaction; PD kills indicate an actual beam interception. These effects explain different mechanisms instead of giving every event the same explosion.

### 11.3 Rendering large salvo populations

Aggregate distant missiles into packets for performance, but preserve actual counts, payload mix, and independent survival statistics in the simulation. Expand selected packets into representative individual tracks at close zoom. Label aggregation and visual sampling so ten visible points cannot be mistaken for ten actual missiles.

Provide physical and displayed scales for wedges and hull symbols. A range ring must remain physical even when the selected ship icon is enlarged.

## 12. Data Contract & Validation Checklist

### 12.1 Minimum structured fields

**S proposed schema:**

```text
SourceValue
  value, unit, evidence_label, source_id, source_locator
  era_or_refit, uncertainty_note, verification_status

CelestialBody
  id, parent_id, physical_radius_km, mass
  orbital_elements_or_scenario_state, epoch, reference_frame
  hyper_limit_radius_km, evidence

Ship
  id, class_id, faction, commission_date, refit_id
  position_km, velocity_km_s, orientation, angular_velocity
  acceleration_limits, drive_state, hyper_readiness
  wedge_geometry, wall_states, subsystems
  weapons_by_mount_and_aspect, magazines, pod_inventory
  sensors, control_channels, external_platforms, evidence

MissileOrPacket
  id, model_and_mod, payload_type, launch_time
  launch_frame, initial_state, drive_stages, coast_intervals
  seeker_state, controller_id, latest_command_time
  target_track_id, terminal_parameters, surviving_count

Contact
  observer_id, sensor_id, measurement_time, receipt_time
  observed_state, predicted_state, uncertainty, identity_confidence

Event
  event_time, actor_id, event_type, parameters
  source_or_reconstruction_note, deterministic_seed
```

Record physical values as numbers and units, not display strings such as `15.30 LM`. Unverified values may be null; absence of data should not silently become zero or a generic capital-ship specification.

### 12.2 Required consistency checks

1. Unit round trips: LM ↔ km ↔ Mkm, and g ↔ km/s².
2. Parent frames: B-system orbits remain centered on B after transformation.
3. Shared projection: a planet and its orbit overlay coincide at every camera angle.
4. Epoch: an orbit radius is never substituted for a fixed current position without a phase assumption.
5. Weapons: per-side counts reconcile with whole-ship totals and available arcs.
6. Inventory: attack, EW, controller, pod, and CM expenditure cannot exceed available stocks.
7. Guidance: ordinary telemetry does not inherit Apollo performance accidentally.
8. Latency: a commander cannot react to an event before its observation arrives.
9. Flight: stage endurance, speed, distance, launch velocity, and target motion agree under the selected motion model.
10. Geometry: roll and launch trajectories respect wedge collisions and open aspects.
11. Escape: the ship is outside all applicable exclusion volumes and its generator is ready.
12. Era: later refits and technologies cannot appear in earlier presets without a deliberate alternate-history option.

## 13. Sources & Further Verification

References were checked on 6 October 2026. **P** entries are author/publisher sources; **W** entries are wiki articles retrieved through indexed article text. Source abbreviations: HH1 = *On Basilisk Station*; HH2 = *The Honor of the Queen*; HH9 = *Ashes of Victory*; HH10 = *War of Honor*; HH11 = *At All Costs*; HH12 = *Mission of Honor*; HH13 = *A Rising Thunder*; HH14 = *Uncompromising Honor*; Companion = *House of Steel*; SI1/SI2 = *The Shadow of Saganami* / *Storm from the Shadows*.

| ID | Source | Evidence / use |
| --- | --- | --- |
| 1 | [House of Steel — Baen sample contents](https://www.baen.com/Chapters/9781451638752/9781451638752_toc.htm) | P; reference scope; detailed technical appendix not retrieved |
| 2 | [Pearls of Weber](https://davidweber.net/pearls-of-weber/) | P; author-background collection and provenance |
| 3 | [More Than Honor — Baen](https://www.baen.com/more-than-honor-25th-anniversary-edition.html) | P; identifies the *Universe of Honor Harrington* essay |
| 4 | [Manticore System](https://honorverse.fandom.com/wiki/Manticore_System) | W; stellar/binary framework and planet identities; Companion cited |
| 5 | [Archived locations/regions reference](https://honorverse.fandom.com/wiki/Honorverse:Wikipedia_content/List_of_regions_of_space_in_the_Honorverse) | W; supplementary outer-planet ordering; lower priority than updated articles |
| 6 | [Salamander](https://honorverse.fandom.com/wiki/Salamander_(planet)) | W; approximately 1.75 LM orbit |
| 7 | [Manticore](https://honorverse.fandom.com/wiki/Manticore) | W; planet dimensions, gravity, calendar, moon |
| 8 | [On Basilisk Station, Chapter 5 — Baen](https://www.baen.com/chapters/basilisk_5.htm) | P; hyper limit, resonance volume, transit rules, sail flash |
| 9 | [Sphinx](https://honorverse.fandom.com/wiki/Sphinx) | W; planet dimensions, gravity, year |
| 10 | [HMSS Hephaestus](https://honorverse.fandom.com/wiki/HMSS_Hephaestus) | W; station association |
| 11 | [Manticore Wormhole Junction](https://honorverse.fandom.com/wiki/Manticore_Wormhole_Junction) | W; node size, termini, Lynx date |
| 12 | [A Call to Insurrection, Chapter 1 — Baen](https://www.baen.com/Chapters/A9781982125899/A9781982125899___3.htm) | P; historical navigation hazards and scatter |
| 13 | [Impeller drive](https://honorverse.fandom.com/wiki/Impeller_drive) | W; rings, wedge, alpha/beta nodes, end closure |
| 14 | [Inertial compensator](https://honorverse.fandom.com/wiki/Inertial_compensator) | W; sump, limits, failure |
| 15 | [Warshawski sail](https://honorverse.fandom.com/wiki/Warshawski_sail) | W; geometry, wave interaction, power |
| 16 | [Weber: Effective speed by hyper band, 22 October 2002](https://www.davidweber.net/posts/view/104/effective-speed-by-hyper-.html) | P; dated band table retrieved through indexed text |
| 17 | [Hyperspace](https://honorverse.fandom.com/wiki/Hyperspace) | W; bands, boundaries, translation hazards |
| 18 | [Spider drive](https://honorverse.fandom.com/wiki/Spider_drive) | W; propulsion, limits, hull form, footprint |
| 19 | [David Weber FAQ](https://davidweber.net/faq/) | P; contact-warhead limitations, cycle stages, sidewall example |
| 20 | [Hyper generator](https://honorverse.fandom.com/wiki/Hyper_generator) | W; readiness and representative cycles |
| 21 | [Streak drive](https://honorverse.fandom.com/wiki/Streak_drive) | W; higher-band access |
| 22 | [Manticoran missile technology](https://honorverse.fandom.com/wiki/Manticoran_missile_technology) | W; missile classifications, reported data, EW, fallback |
| 23 | [Missile](https://honorverse.fandom.com/wiki/Missile) | W; launch, typical endurance, pod configurations, CM mechanism |
| 24 | [Apollo missile system](https://honorverse.fandom.com/wiki/Apollo_(missile_system)) | W; eight-plus-one architecture |
| 25 | [Archived weapons reference](https://honorverse.fandom.com/wiki/Honorverse:Wikipedia_content/Weapons_technology_in_the_Honorverse) | W; broad energy/laserhead description; use model-specific sources first |
| 26 | [Space Weapons Technology](https://honorverse.fandom.com/wiki/Space_Weapons_Technology) | W; grav lance, Crippler, energy torpedo, Keyhole |
| 27 | [Archived spacecraft reference](https://honorverse.fandom.com/wiki/Honorverse:Wikipedia_content/Spacecraft_in_the_Honorverse) | W; directional protection and active-defense context |
| 28 | [Graser torpedo](https://honorverse.fandom.com/wiki/Graser_torpedo) | W; duration, design, Oyster Bay date; HH12 Ch. 28 cited |
| 29 | [Mesan missile technology](https://honorverse.fandom.com/wiki/Mesan_missile_technology) | W; Cataphract and later Lorica |
| 30 | [Invictus class](https://honorverse.fandom.com/wiki/Invictus_class) | W; dimensions, mounts, pod cadence, Keyhole distinction |
| 31 | [Nike class](https://honorverse.fandom.com/wiki/Nike_class) | W; conventional BC data |
| 32 | [Edward Saganami-C class](https://honorverse.fandom.com/wiki/Edward_Saganami_C_class) | W; armament, cadence, dimensions, infobox conversion conflict |
| 33 | [Shrike-B class](https://honorverse.fandom.com/wiki/Shrike_B_class) | W; armament, magazines, wall-power restriction |
| 34 | [Katana class](https://honorverse.fandom.com/wiki/Katana_class) | W; role, launchers, defensive weapon mix |
| 35 | [Agamemnon class](https://honorverse.fandom.com/wiki/Agamemnon_class) | W; true BC(P) comparison |
| 36 | [Sovereign of Space class](https://honorverse.fandom.com/wiki/Sovereign_of_Space_class) | W; RHN pod-layer comparison |
| 37 | [Honor Harrington II class](https://honorverse.fandom.com/wiki/Honor_Harrington_II_class) | W; retained internal launchers |
| 38 | [Covington class](https://honorverse.fandom.com/wiki/Covington_class) | W; carrier capacity and refit differences |
| 39 | [Gryphon class](https://honorverse.fandom.com/wiki/Gryphon_class) | W; conventional SD comparison |
| 40 | [Cimeterre class](https://honorverse.fandom.com/wiki/Cimeterre_class) | W; RHN LAC roles, variants, Triple Ripple |
| 41 | [Gravitic sensor](https://honorverse.fandom.com/wiki/Gravitic_sensor) | W; FTL detection mechanism and limits |
| 42 | [Reconnaissance drone](https://honorverse.fandom.com/wiki/Reconnaissance_drone) | W; early pulse refresh time; HH2 cited |
| 43 | [Ghost Rider](https://honorverse.fandom.com/wiki/Ghost_Rider) | W; development-program scope |
| 44 | [Moriarty](https://honorverse.fandom.com/wiki/Moriarty) | W; RHN system control |
| 45 | [Mycroft](https://honorverse.fandom.com/wiki/Mycroft) | W; later distributed defense and deployment date |
| 46 | [Honorverse Analytics: Why Manticore Won the War — Baen](https://www.baen.com/honorverse_analytics) | P; BuNine-associated operational/strategic analysis |
| 47 | [Battle of Manticore](https://honorverse.fandom.com/wiki/Battle_of_Manticore) | W; Operation Beatrice, Eighth Fleet salvo checkpoint |

For a publication-grade or fully deterministic canon dataset, the next verification targets are the specific *House of Steel* astrography tables/maps, class drawings and refit notes, and the relevant *At All Costs* engagement passages. These should resolve orbital conflicts, exact hardpoint interpretation, drive profiles, and event timing; the present report does not pretend that every such value is already settled.

## Appendix A. Preserved Draft Parameters Requiring Verification

These are retained to avoid losing potentially useful source leads. **Every value in this appendix is S / unverified**, unless a correction elsewhere explicitly supersedes it. Do not import this table into a canon-only preset.

| Draft item | Original value / assertion | Treatment |
| --- | --- | --- |
| B-star hyper limit | 22.12 LM | Keep provisional; verify against the selected map edition |
| Inner planet orbits | Phoenix 6.60 LM; Manticore 12.40 LM | Manticore has a compatible derived year/orbit cross-check; exact published radii still needed |
| Sphinx orbit | 15.30 LM | Scenario value; conflict with retrieved 5.22-year period documented |
| Outer planet orbits | Roc 28.50 LM; Draco 40.55 LM; Wyvern 85.20 LM | Planet order/type corrected; radius assignments not certified |
| B-system orbits | Gryphon 18.20 LM; Unicorn Belt 8.50 LM | Exact radii not certified |
| Planet dimensions | Salamander 0.41 Earth radii / 0.25g; Phoenix 0.75 Earth radii / 0.35g; Gryphon radius 5,939 km / 1.05g | Not independently validated |
| Draco satellites | Seven moons | Not independently validated |
| Junction exact distances | 412 LM from A; approximately 660 LM from B | Preserve as map parameters, distinct from approximate seven-LH wording |
| Resonance shape | 44 LM base; Sphinx 102 Mkm inside | Requires directional geometry and a cited map; not a radial consequence |
| Wedge appearance | Cyan/magenta sheets; 100 km offset; gradient over 100,000 m/s² | Artistic or provisional parameters |
| Sail performance | 150–500 km diameter; 5,500g | Requires class/route-specific source |
| Hyper translation velocities | ≤0.30c; standard 0.23c | Requires passage and frame convention |
| Spider fine limits | 150–210g; emergency 310g / felt 9g; one-LS stealth boundary | Fine numerical limits unverified; fixed detection boundary removed |
| Laserhead standoff | 30,000–40,000 km | Warhead- and aspect-dependent configuration until verified |
| Energy output | Petawatt to exawatt | No universal output certified |
| PD specification | Fourteen emitters; sixteen-second cycle; 150,000 km | Class/era-specific provisional parameters |
| Shrike reactor | Isler GRAVMAK fission plant; eighteen-year core | Model and life unverified here |
| Katana dimensions/performance | 19,500 tonnes; 71 × 20 × 20 m; 640.4g; six aft PD clusters | Keep optional until sourced |
| FTL coefficient | 64c | Declared provisional timing preset; finite delay demonstrated |

## Appendix B. Major Corrections to the Supplied Edition

| Supplied statement | Revised treatment |
| --- | --- |
| All parameters directly derived from primary canon records | Evidence levels, date/refit labels, and unresolved values now explicit |
| 739 LM ≈ 1.329 × 10⁸ km | ≈ 1.32928 × 10¹⁰ km |
| Roc A-V terrestrial; Draco A-VI | Draco A-V and Roc A-VI; both gas giants |
| Phoenix named as B star / habitable A-II | Neither designation certified by retrieved evidence |
| Exact inherited orbits treated as canonical ephemeris | Preserved as provisional; orbital phase and period conflicts identified |
| Every transit inside a perfect resonance cone immediately fatal | Separate actual hyper exclusions, irregular resonance hazards, and permitted approaches |
| Nike BC(P), fifty broadside tubes, thirty-two broadside grasers | Conventional BC; per-side twenty-five tubes and twelve grasers |
| Saganami-C forty tubes per broadside | Twenty per side; forty combined |
| Saganami-C “128 Apollo links” | Removed as unverified; ordinary telemetry distinguished from Apollo |
| Invictus magazine equals 12,888 missiles | Pod count retained; load-specific arithmetic provided |
| Every Invictus necessarily has Keyhole II | Individual ship equipment must be checked |
| Bow wall grants complete forward immunity | Sidewall-grade protection with acceleration/power constraints |
| Grav lance upgrade reaches one million km | Unsupported upgrade removed |
| Defensive roll stops every incoming attack | Directional protection, multiple threat axes, and firing tradeoffs modeled |
| Capital ships universally spaced ten–twenty km | Separation derived from wedge volumes and maneuver clearance |
| Ghost Rider and Keyhole II treated as one drone type | Development program, defensive platform, and Apollo control separated |
| FTL described as zero tactical lag | Finite propagation, measurement, refresh, and processing delays separated |
| Mk16 and Mk23 share one performance profile | DDM/MDM, generation, warhead mod, and launch/control system distinguished |
