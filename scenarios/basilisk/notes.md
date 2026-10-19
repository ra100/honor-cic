# First Battle of Basilisk: sources, plot and caveats

The viewer replays a reconstruction. Every number carries an evidence label:

- **P**: *On Basilisk Station*, quoted from the chapter named.
- **W**: the Honorverse wiki or the project's MTS reference tables.
- **D**: derived by calculation from sourced inputs.
- **S**: speculative. These are reconstructions and provisional values, never canon.

## Sources
- David Weber, *On Basilisk Station*, chapters 27 to 32 (Baen).
- Honorverse wiki: First Battle of Basilisk, HMS Fearless (CL-56), Courageous class, PMSS Sirius, Basilisk System, Hyper limit.
- A supplied battle extract. It was used as a starting point only; where it disagrees with the novel or with physics, the novel and physics win (see the table below).

## The plot, worked through
Times are from Sirius breaking orbit (T+0). Accelerations use g = 9.80665 m/s², so 410 g = 4.021 km/s², 520 g = 5.099 km/s² and the 110 g difference is 1.079 km/s².

- **The run to the limit.** Sirius burns straight out from Medusa at 410 g (P). From rest, 12.0 LM takes 172.7 minutes (D): the novel's "just under a hundred and seventy-three minutes" and its limit "barely twelve light-minutes out from Medusa" (P, ch. 27) agree. With the G5 limit at 19.8 LM (W) that puts Medusa at 7.8 LM; the wiki's "about seven" is kept as the rounder figure.
- **The lead.** Fearless starts 15 minutes behind (extract, S). That one number reproduces every chase figure the novel gives:
  - Velocities match after 55.9 minutes of pursuit at 17,106 km/s (D). The extract's 17,106 km/s is right; its "46 minutes" is not.
  - The range peaks there at 7.70 Mkm (D).
  - At T+73:53 Fearless is at 18,016 km/s, "just over eighteen thousand", and the range is 25.62 light-seconds (P, ch. 29). The warning shot goes then.
  - At 63 minutes of pursuit Fearless has come 36.4 Mkm and the range is 7.60 Mkm (P, ch. 30: 36.5 Mkm and 7.6 Mkm). Sirius opens fire then.
  - Unopposed, Fearless would draw level 118.9 minutes into the pursuit (T+133:52), 39 minutes before Sirius reaches the limit, closing at 4,075 km/s (D). Overtaking takes "just over another hundred and seven minutes" from about T+27, when Honor works the problem (P, ch. 27).
- **Missiles.** A 1900 PD missile has one drive: 85,000 g for one minute, or, throttled to 42,500 g (417 km/s²), three minutes (P, ch. 29). The solver flies them at the throttled setting and lets them coast after burnout.
  - Warning shot: solved flight 192.9 s against the quoted 192.8 s (P). Terminal velocity is 75,000 km/s over the launcher, 93,000 km/s in the system frame, about 10 Mkm from launch in 180 s (P).
  - Sirius's first salvo: solved flight 189.0 s against the quoted 188 s, burning out about ten seconds out (P: nine seconds).
- **The exchange.** Sirius fires pairs every 15 s, then six-missile salvos (W, extract): 108 missiles without a hit (W: over ninety). At 24 LS (T+87:00) Fearless fires two and hits a cargo hold (W). A later volley wrecks Fearless's forward impellers and opens Fusion One (P, ch. 30) at T+95:00, 17 minutes into the exchange (extract, S). She drops to 260 g for four minutes (S) until her engineers restore the ring (P, ch. 31). Another hit takes two of Sirius's beta nodes, cutting her to 373 g (P: over nine percent).
- **The turn and the trap.** At T+110:00 (S) Coglin turns back to kill the only witness (P). He cuts his drive; Fearless keeps 520 g until the closing speed reaches the quoted 3,392 km/s (P, ch. 31), then plays dead with her drive down. With both ships coasting the closing speed holds, which is why the novel can quote a single figure: the range passes 500,000 km at T+133:47 (P). Sirius burns across Fearless's bow to rake her; at 68,000 km Fearless rolls, fires the grav lance (P: barely 100,000 km at best) and four energy torpedo launchers (P).

## Conflicts with the extract

| Extract | Used here | Why |
|---|---|---|
| 2 October 1900 PD | 3 September 1901 PD (W) | Wiki infobox and timeline. |
| Hyper limit "600 light-minutes, near the Tellerman Wave" | 19.8 LM (W) | 600 LM is the distance to the Basilisk Terminus (W). |
| 17,106 km/s after 46 minutes | after 55.9 minutes (D) | 410 g × 70.9 min = 520 g × 55.9 min = 17,106 km/s. |
| Closing over 77,000 km/s in the terminal sprint | at most about 4,100 km/s (D); 3,392 km/s quoted (P) | 77,000 km/s is far above either ship's own speed (Fearless never passes 30,000 km/s here). |
| Grav lance fired at 400,000 km | 68,000 km (S) inside the novel's 100,000 km ceiling (P) | 400,000 km is the general beam range against a sidewall. |
| "0.3 light-seconds" = 400,000 km | 0.3 LS is 90,000 km | 400,000 km is 1.33 LS. |
| Burn "1 minute to 3" from halving acceleration | kept (P) | It is the novel's figure; a missile's drive endurance rises faster than its thrust falls. |
| Over 300 wounded | 58 wounded (W), 107 dead (P) | 107 was more than a third of those aboard (P), so there were fewer than 321. |
| Drifted 94 million km in 45 minutes | about 81 Mkm (D) | She coasts at 29,842 km/s in this plot; 94 Mkm in 45 minutes needs 34,800 km/s. Not found in the novel. |
| Sirius about 8 million tons | unknown (S) | Not found in the sources; chapter 30 says only that a Trumball-class Q-ship was over 1.5 million tons smaller. |
| Warning shot from 85,000 g throttled to 42,500 g | kept (P) | Confirmed by chapter 29 (417 KPS²). |

## Reconstruction choices
- **Geometry (S)**: Sirius runs straight out through Medusa, the shortest course to the limit. The extract's "274° by 093°" bearing has no reference frame and is not used. Medusa's orbital speed (about 29 km/s, D) is shared by every ship at T+0.
- **Hits (S)**: the defense constants (Pk 0.8 for Fearless, 0.75 for Sirius) and the fire plans' seeds are chosen so the replay follows the novel's order of hits: none from the first ninety-odd missiles, the bow hit 17 minutes in, one Fearless hit on a cargo hold and one on Sirius's beta nodes, then the heavy hits as Coglin turns. The decoys and the Echo-Seven-One evasion pattern are folded into Fearless's constants, not modeled.
- **Warning shot**: carried as one non-attack vehicle, so it does no damage. The solver aims it at Sirius; the real one burst 5,000 km clear, which changes the flight time by under 0.1 s.
- **Statuses**: Fearless is shown crippled from the first impeller hit, though she fights on; she was a constructive total loss (W). The courier boat is crippled in orbit before the chase (P).
- **Turns**: Sirius turns her bow toward Fearless when Coglin turns back and swings across Fearless's bow for the crossing burn. Fearless turns across Sirius's path when she plays dead and rolls 180° before the lance fires. Timings are S.
- **Weapons**: Fearless's broadside counts are S beyond the wiki's fourteen energy torpedo launchers; Sirius's armament is S throughout.
- **Not shown**: the Havenite task force waiting beyond the limit and Home Fleet's arrival after Case Zulu are outside the replay.
