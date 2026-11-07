// What notable buildings really look like, for tiles where the plain base
// render can't show it. Added to the prompt of each tile a landmark falls in.

import { BBOX, kx, ky } from "../geo.mjs";

export const LANDMARKS = [
  // The station straddles two tiles: the shed is painted by one, the façade by the other.
  { name: "the Gare du Nord train shed", lon: 2.3554, lat: 48.8810, avoid: "the Gare du Nord train shed", look: "the vast 19th-century iron-and-glass train shed behind the station, seen from above: long parallel pitched roofs of glass panes on dark iron trusses covering the ends of the platforms and tracks, with trains inside; no stone façade on this part" },
  { name: "Gare du Nord", lon: 2.3553, lat: 48.8798, avoid: "the Gare du Nord stone façade (the train shed behind it is fine)", look: "the 1860s Beaux-Arts railway station: a monumental pale limestone façade facing south onto the square, with tall arched windows, giant pilasters and a row of 23 statues along the roofline; behind it a vast iron-and-glass train shed with long glazed roofs over the platforms" },
  { name: "Gare de l'Est", lon: 2.3590, lat: 48.8763, look: "the 1849 railway station: a limestone façade facing south down the boulevard with a huge semicircular glazed rose window in the central pediment, between two classical wings; iron-and-glass train sheds behind" },
  { name: "Sacré-Cœur", radius: 420, lon: 2.3431, lat: 48.8867, look: "the basilica of Sacré-Cœur: brilliant white travertine, a tall central dome with smaller domes around it and a square bell tower behind, on top of the Montmartre hill with stairs and terraced gardens below" },
  { name: "Moulin de la Galette", lon: 2.3374, lat: 48.8876, look: "a small old wooden windmill with dark sails on a mound among trees" },
  { name: "Le Louxor", lon: 2.3497, lat: 48.8833, look: "a 1921 cinema on a street corner with an Egyptian-revival façade of blue, black and gold mosaics" },
  { name: "Halle Pajol", lon: 2.3618, lat: 48.8881, look: "a long former railway warehouse with a big shallow-pitched roof covered in solar panels, open timber-and-steel structure" },
  { name: "Rotonde de la Villette", lon: 2.3693, lat: 48.8838, look: "Ledoux's 1780s neoclassical toll house: a cylindrical pale stone rotunda ringed by paired columns, rising from a square base with columned porticos, in an open square at the end of the canal basin" },
  { name: "Bassin de la Villette", lon: 2.3735, lat: 48.8865, look: "a long straight canal basin with stone quays, plane trees and moored boats" },
  { name: "Canal Saint-Martin", lon: 2.3655, lat: 48.8710, look: "the canal with stone locks, arched green iron footbridges and rows of plane trees along both quays" },
  { name: "Hôpital Saint-Louis", lon: 2.3685, lat: 48.8738, look: "the 1607 hospital in the style of the Place des Vosges: red brick façades with white stone corners and window frames, steep dark slate roofs, around a large square garden courtyard" },
  { name: "Église Saint-Vincent-de-Paul", lon: 2.3519, lat: 48.8783, look: "an 1840s neoclassical church at the top of a grand double ramp staircase, with a columned portico, triangular pediment and two square bell towers" },
  { name: "Église Saint-Laurent", lon: 2.3593, lat: 48.8762, look: "a Gothic church with a pointed stone spire and flying buttresses" },
  { name: "Buttes-Chaumont", lon: 2.3826, lat: 48.8806, look: "a hilly English-style park with a lake; on a tall rocky island cliff stands the Temple de la Sibylle, a small round temple with Corinthian columns, reached by a suspension bridge" },
  { name: "Place des Fêtes", lon: 2.3928, lat: 48.8768, look: "1960s–70s concrete residential towers and long slabs around a tree-planted square" },
  { name: "Église Saint-Jean-Baptiste de Belleville", lon: 2.3836, lat: 48.8745, look: "a Gothic-revival church with two tall pointed stone spires on its façade" },
  { name: "Église Notre-Dame-de-la-Croix", lon: 2.3864, lat: 48.8691, look: "a large Romanesque-revival church with a very tall square bell tower, at the top of wide stairs" },
  { name: "Cirque d'Hiver", lon: 2.3667, lat: 48.8628, look: "the 1852 winter circus: a 20-sided polygonal building with a cream façade, Corinthian pilasters, a sculpted frieze and two equestrian statues by the entrance" },
  { name: "Philharmonie de Paris", radius: 380, lon: 2.3942, lat: 48.8918, look: "Jean Nouvel's 2015 concert hall: a sloping angular metallic hill clad in grey and black aluminium tiles in a bird-shaped pattern" },
  { name: "Cité des Sciences et La Géode", radius: 460, lon: 2.3880, lat: 48.8955, look: "a huge glass-and-steel science museum building, and in front of it La Géode, a perfectly round mirror-polished steel sphere reflecting the sky" },
  { name: "Musée du Louvre", radius: 440, lon: 2.3376, lat: 48.8606, look: "the Louvre palace: long Renaissance and Second Empire wings of pale ornate limestone with tall steep dark slate roofs, sculpted pavilions with domed roofs, enclosing the Cour Napoléon where the glass-and-steel Louvre Pyramid stands among triangular fountain pools, and to the east the square Cour Carrée courtyard with uniform classical façades" },
  { name: "Arc de Triomphe du Carrousel", lon: 2.3329, lat: 48.8617, look: "a small triumphal arch of pink marble columns with a bronze chariot on top, at the west end of the Louvre courtyard" },
  { name: "Palais-Royal", lon: 2.3371, lat: 48.8638, look: "the Palais-Royal: a long rectangular formal garden with rows of clipped lime trees and a central fountain, enclosed by uniform 18th-century stone arcades, with the black-and-white striped Buren columns in the southern courtyard" },
  { name: "Opéra Garnier", lon: 2.3316, lat: 48.8720, look: "the Palais Garnier opera house: an opulent Beaux-Arts façade of columns and gilded statues, a green copper dome over the auditorium and a tall triangular stage roof crowned by a gilded statue of Apollo" },
  { name: "Galeries Lafayette", slug: "galeries-lafayette", radius: 170, lon: 2.3322, lat: 48.87366, look: "the Galeries Lafayette department store: ornate stone façades and a large stained-glass Art Nouveau dome visible on the roof" },
  { name: "Bourse de Commerce", lon: 2.3428, lat: 48.8628, look: "a circular domed building with a glass-and-iron dome, a ring of classical stone façade and a tall freestanding stone column beside it" },
  { name: "Église Saint-Eustache", lon: 2.3451, lat: 48.8634, look: "a huge Gothic-Renaissance church with flying buttresses, a tall steep slate roof and a large rose window, next to the Les Halles garden" },
  { name: "Centre Pompidou", lon: 2.3522, lat: 48.8606, look: "the 1977 high-tech museum: an exposed steel frame with brightly coloured pipes (blue, green, red, yellow) on the façade, a red-and-glass escalator tube zigzagging up the front, facing a sloping paved square" },
  { name: "La Samaritaine", lon: 2.3425, lat: 48.8590, look: "the Samaritaine department store: Art Nouveau and Art Deco stone façades with ornate ironwork and a wavy glass façade on the Rivoli side" },
  { name: "Tour Saint-Jacques", lon: 2.3488, lat: 48.8579, look: "a tall slender white flamboyant-Gothic bell tower standing alone in a small square garden" },
  { name: "Porte Saint-Denis", lon: 2.35269, lat: 48.86979, look: "a large 17th-century stone triumphal arch with carved obelisks on its face, standing in the middle of the boulevard" },
  { name: "Porte Saint-Martin", lon: 2.35565, lat: 48.86915, look: "a 17th-century stone triumphal arch with rusticated stonework, standing in the middle of the boulevard" },
  { name: "Palais Brongniart", lon: 2.3412, lat: 48.8690, look: "the former stock exchange: a neoclassical temple-like building surrounded by a peristyle of Corinthian columns" },
  { name: "Grande Halle de la Villette", radius: 440, lon: 2.3905, lat: 48.8907, look: "a vast 19th-century iron-and-glass market hall with a long pitched glazed roof, in the Parc de la Villette with its red folly pavilions" },
  { name: "Le Zénith", radius: 300, lon: 2.3935, lat: 48.8941, look: "a low grey tent-like concert hall with a polyester canopy roof held by a steel mast" },
  { name: "Boulevard Richard-Lenoir", lon: 2.3707, lat: 48.8625, look: "a wide boulevard with NO water: the Canal Saint-Martin runs underground here, covered by a long central strip of gardens, lawns, playgrounds and tree-lined promenades between the two carriageways, with the Bastille market stalls on it" },
  { name: "Square Frédérick-Lemaître", lon: 2.3680, lat: 48.8678, look: "a small garden square on top of the covered canal (no open water), just south of where the canal comes out of its tunnel at the Temple lock" },
  { name: "Cimetière du Père-Lachaise", lon: 2.3960, lat: 48.8605, look: "a wooded cemetery densely packed with stone tombs and small chapels along cobbled paths" },
];

const lat0 = (BBOX.s + BBOX.n) / 2;
const lon0 = (BBOX.w + BBOX.e) / 2;

/** A landmark's position in mosaic pixels. `m` is paint/manifest.json. */
export function landmarkPixel(m, l) {
  // World metres, then the iso projection for rotation 3 (sx = x + y, sy = (y - x) / 2).
  const x = (l.lon - lon0) * kx, y = -(l.lat - lat0) * ky;
  return [(x + y - m.origin[0]) * m.zoom, ((y - x) / 2 - m.origin[1]) * m.zoom];
}

/**
 * The one tile that paints a landmark: the tile whose centre is closest to it.
 * Giving the hint to every tile it falls in made each of them paint it, at
 * slightly different places, so it showed up twice after stitching.
 */
export function ownerTile(m, l) {
  const [px, py] = landmarkPixel(m, l);
  let best = null, bestD = Infinity;
  for (const t of m.tiles) {
    const d = Math.hypot(px - (t.c * m.step + m.tile / 2), py - (t.r * m.step + m.tile / 2));
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** Landmarks this tile owns, with where they appear in it. */
export function landmarksInTile(m, c, r) {
  const found = [];
  for (const l of LANDMARKS) {
    const o = ownerTile(m, l);
    if (!o || o.c !== c || o.r !== r) continue;
    const [gx, gy] = landmarkPixel(m, l);
    const px = gx - c * m.step, py = gy - r * m.step;
    const h = px < m.tile / 3 ? "left" : px > (2 * m.tile) / 3 ? "right" : "";
    const v = py < m.tile / 3 ? "upper" : py > (2 * m.tile) / 3 ? "lower" : "";
    const where = h || v ? `${v}${v && h ? " " : ""}${h} part` : "centre";
    found.push({ ...l, where: `in the ${where} of the image (about ${Math.round((px / m.tile) * 100)}% from the left, ${Math.round((py / m.tile) * 100)}% from the top)` });
  }
  return found;
}

/** Landmarks near this tile that another tile paints: this one must not draw them. */
export function landmarksNearTile(m, c, r) {
  return LANDMARKS.filter((l) => {
    const o = ownerTile(m, l);
    if (!o || (o.c === c && o.r === r)) return false;
    const [gx, gy] = landmarkPixel(m, l);
    const px = gx - c * m.step, py = gy - r * m.step, M = 250;
    return px > -M && py > -M && px < m.tile + M && py < m.tile + M;
  });
}
