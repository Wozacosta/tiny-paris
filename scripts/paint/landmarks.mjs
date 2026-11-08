// What notable buildings really look like, for tiles where the plain base
// render can't show it. Added to the prompt of each tile a landmark falls in.

import { ORIGIN, kx, ky } from "../geo.mjs";

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

  // The rest of Paris inside the périphérique.
  // Spans two tiles: each paints its part, then a spot repaint draws it whole.
  { name: "Tour Eiffel", tall: true, radius: 520, lon: 2.29448, lat: 48.85826, look: "the Eiffel Tower: a very tall wrought-iron lattice tower painted bronze-brown, standing on four curved splayed legs joined by great arches at the first level, tapering to a slender spire with a small top platform, with the open Champ de Mars lawns stretching away from it" },
  { name: "Arc de Triomphe", radius: 340, lon: 2.29504, lat: 48.87378, look: "the Arc de Triomphe: a massive pale limestone triumphal arch with one great arched opening on each side and large sculpted reliefs, standing alone in the middle of the huge round Place de l'Étoile, with twelve avenues radiating from it" },
  { name: "Cathédrale Notre-Dame de Paris", radius: 380, lon: 2.34990, lat: 48.85296, look: "Notre-Dame cathedral on its island: a Gothic cathedral of pale stone with two square towers on the west façade above three portals and a rose window, a long nave under a lead roof with a slender lead spire at the crossing, and flying buttresses all around the apse" },
  { name: "Sainte-Chapelle", lon: 2.34500, lat: 48.85540, look: "the Sainte-Chapelle: a tall narrow Gothic chapel of pale stone with huge stained-glass windows, a steep blue-grey slate roof and a slender gilded spire, inside the courtyard of the Palais de Justice" },
  { name: "Hôtel de Ville", radius: 320, lon: 2.35224, lat: 48.85638, look: "Paris city hall: a large Neo-Renaissance palace of pale stone with many tall steep slate pavilion roofs, a central clock tower, rows of statues on the façade, facing a wide open square" },
  { name: "Panthéon", radius: 320, lon: 2.34600, lat: 48.84622, look: "the Panthéon: a neoclassical temple of pale limestone with a columned portico and pediment, a Greek-cross plan, and a huge dome on a ring of columns at its centre, at the top of a hill" },
  { name: "Les Invalides", radius: 440, lon: 2.31258, lat: 48.85502, look: "Les Invalides: a long classical stone complex around courtyards with dark slate roofs, and at its south end the Dôme des Invalides, a tall church dome covered in gold leaf with a lantern on top" },
  { name: "Musée d'Orsay", radius: 340, lon: 2.32656, lat: 48.85998, look: "the Musée d'Orsay: a former Beaux-Arts railway station on the river bank, a long pale stone building with a great arched glass-and-iron roof and two large clock faces on its river front" },
  { name: "Grand Palais", radius: 380, lon: 2.31252, lat: 48.86610, look: "the Grand Palais: a huge Beaux-Arts exhibition hall of stone with colonnaded façades and a vast barrel-vaulted glass-and-steel roof with a glass dome, with bronze chariot statues at its corners" },
  { name: "Petit Palais", lon: 2.31470, lat: 48.86600, look: "the Petit Palais: a Beaux-Arts palace of pale stone with an Ionic colonnade, a monumental arched entrance under a small dome, around a semicircular garden courtyard" },
  { name: "Place de la Concorde", radius: 320, lon: 2.32118, lat: 48.86560, look: "the Place de la Concorde: a vast open paved square with the tall thin Egyptian obelisk of Luxor at its centre, two large ornate fountains and stone statues at its corners" },
  { name: "Église de la Madeleine", lon: 2.32447, lat: 48.87004, look: "La Madeleine: a church built as a Roman temple of pale stone, ringed by tall Corinthian columns on all sides under a single pediment and a low roof, standing on a high podium" },
  { name: "Place Vendôme", lon: 2.32940, lat: 48.86750, look: "the Place Vendôme: an octagonal square enclosed by uniform classical stone façades with arcades and slate mansards, with a tall bronze column topped by a statue in its middle" },
  { name: "Tour Montparnasse", radius: 320, lon: 2.32193, lat: 48.84212, look: "the Tour Montparnasse: a single 210 m office skyscraper, a slim rounded slab clad in dark bronze-tinted glass and steel, towering over the low city, with a lower shopping centre at its foot" },
  { name: "Palais du Luxembourg", radius: 440, lon: 2.33711, lat: 48.84862, look: "the Luxembourg palace (the Senate): a 17th-century palace of pale stone with a domed central pavilion and slate roofs, overlooking the formal Luxembourg gardens with an octagonal basin, terraces and rows of trees" },
  { name: "Église Saint-Sulpice", lon: 2.33476, lat: 48.85098, look: "Saint-Sulpice: a massive classical church of pale stone with a two-storey colonnaded west façade between two square towers of unequal height, facing a square with a large fountain" },
  { name: "Église Saint-Germain-des-Prés", lon: 2.33427, lat: 48.85394, look: "Saint-Germain-des-Prés: a Romanesque abbey church of grey stone with a single square bell tower with a slate spire at its west end and a long nave" },
  { name: "Opéra Bastille", radius: 340, lon: 2.37000, lat: 48.85213, look: "the Opéra Bastille: a large modern opera house of curved glass and grey-blue granite façades, with a big cylindrical glazed front" },
  { name: "Colonne de Juillet", lon: 2.36910, lat: 48.85320, look: "the July Column: a tall green bronze column topped by a small gilded winged statue, in the middle of the large round Place de la Bastille with traffic around it" },
  { name: "Place des Vosges", lon: 2.36549, lat: 48.85561, look: "the Place des Vosges: a perfectly square garden with lawns, trees and fountains, enclosed by identical red-brick and white-stone houses with steep dark slate roofs over arcades" },
  { name: "Bibliothèque nationale François-Mitterrand", radius: 400, lon: 2.37595, lat: 48.83367, look: "the national library: four tall L-shaped glass towers like open books at the corners of a huge wooden-decked esplanade, around a sunken rectangular garden of tall pine trees" },
  { name: "Accor Arena", lon: 2.37846, lat: 48.83864, look: "the Bercy arena: a pyramid-shaped sports hall whose sloping sides are covered in green lawn, with a glass-and-steel structure on top" },
  { name: "Gare de Lyon", radius: 340, lon: 2.37388, lat: 48.84442, look: "the Gare de Lyon: a Beaux-Arts railway station with a tall square clock tower at its corner, a long ornate stone façade and iron-and-glass train sheds behind" },
  { name: "Gare d'Austerlitz", radius: 340, lon: 2.36500, lat: 48.84249, look: "the Gare d'Austerlitz: a long 19th-century railway station of pale stone with a huge single-span iron-and-glass train shed behind its façade" },
  { name: "Gare Montparnasse", radius: 340, lon: 2.31930, lat: 48.84070, look: "the Gare Montparnasse: a long modern glass-and-steel station building, with the Jardin Atlantique, a garden built on a deck over the tracks, behind it" },
  { name: "Gare Saint-Lazare", radius: 340, lon: 2.32496, lat: 48.87633, look: "the Gare Saint-Lazare: a 19th-century stone station façade with a large clock, and behind it wide iron-and-glass train sheds over many tracks" },
  { name: "Palais de Chaillot", radius: 420, lon: 2.28763, lat: 48.86249, look: "the Palais de Chaillot: two long curved pale stone wings with flat roofs on the Trocadéro hill, framing a wide open esplanade, with terraced gardens and long fountain basins stepping down to the river" },
  { name: "Pont Alexandre III", lon: 2.31353, lat: 48.86393, look: "the Pont Alexandre III: a single low steel arch bridge over the river, ornate with gilded winged statues on tall stone pillars at both ends and Art Nouveau lamps along it" },
  { name: "École Militaire", radius: 360, lon: 2.30447, lat: 48.85107, look: "the École Militaire: a long 18th-century classical military academy of pale stone with a central domed pavilion and columns, at the end of the Champ de Mars" },
  { name: "Institut de France", lon: 2.33733, lat: 48.85738, look: "the Institut de France: a 17th-century classical building with a curved façade on the river bank and a central chapel with a gilded dome" },
  { name: "Conciergerie", lon: 2.34555, lat: 48.85614, look: "the Conciergerie: a medieval palace on the island's river bank with round towers with pointed slate roofs and a square clock tower at its corner" },
  { name: "Val-de-Grâce", lon: 2.34199, lat: 48.84034, look: "the Val-de-Grâce: a Baroque church with a tall ribbed dome decorated with gilding, behind a two-storey columned façade, beside a cloister" },
  { name: "Institut du monde arabe", lon: 2.35730, lat: 48.84898, look: "the Institut du monde arabe: a modern building with a long glass façade made of grids of square metal screens like mashrabiya, and a curved wing along the river" },
  { name: "Grande Mosquée de Paris", lon: 2.35511, lat: 48.84193, look: "the Great Mosque of Paris: a Hispano-Moorish complex of white walls and green-tiled roofs around a garden courtyard, with a square white minaret" },
  { name: "Jardin des Plantes", radius: 440, lon: 2.35880, lat: 48.84390, look: "the botanical garden: long formal flower beds and tree alleys, glass greenhouses, and at one end the Grande Galerie de l'Évolution, a large stone museum building" },
  { name: "Parc André-Citroën", radius: 420, lon: 2.27470, lat: 48.84090, look: "a modern park: a huge rectangular lawn sloping to the river, framed by two tall glass greenhouses, with water jets on a plaza and themed gardens" },
  { name: "Maison de la Radio", radius: 340, lon: 2.27880, lat: 48.85266, look: "the Maison de la Radio: a large round building with a curved ring of white-and-aluminium offices around a central tower, by the river" },
  { name: "Parc Monceau", radius: 360, lon: 2.30880, lat: 48.87970, look: "Parc Monceau: an English-style park with winding paths, lawns, large trees, an oval pond lined with a Corinthian colonnade, and a small round rotunda at its entrance" },
  { name: "Église Saint-Augustin", lon: 2.31840, lat: 48.87584, look: "Saint-Augustin: a large 1860s church of stone on an iron frame, with a big dome over the crossing and a narrow tall façade" },
  { name: "Tribunal de Paris", radius: 320, lon: 2.30995, lat: 48.89499, look: "the Paris law courts tower by Renzo Piano: a 160 m glass tower made of three stacked blocks of decreasing size, with trees on the terraces between them" },
  { name: "Parc Montsouris", radius: 400, lon: 2.33840, lat: 48.82230, look: "Parc Montsouris: a hilly English-style park with a lake, lawns, winding paths and large trees" },
  { name: "Cité internationale universitaire", radius: 440, lon: 2.33780, lat: 48.81970, look: "the international student city: many residence halls in different national styles scattered across a big wooded park, with the large Maison internationale, a 1930s palace with a central tower" },
  { name: "Salpêtrière", lon: 2.36070, lat: 48.83860, look: "the Pitié-Salpêtrière hospital chapel: a 17th-century classical church with an octagonal dome on a drum, among long stone hospital wings" },
  { name: "Ministère de l'Économie à Bercy", radius: 340, lon: 2.37400, lat: 48.83820, look: "the Finance Ministry: a very long modern building like a bridge, stretching out over the riverside road with its end standing on pillars in the river" },
  { name: "Musée du quai Branly", lon: 2.29763, lat: 48.86088, look: "the Musée du quai Branly by Jean Nouvel (2006): a long, gently curving museum raised on thin stilts above a wild garden of tall trees and grasses; its long north façade is dark rust-red and brown, studded with about thirty projecting boxes in ochre, red, brown and yellow; a flat dark roof; along the Quai Branly a tall clear glass wall separates the garden from the street, and the office block at the east end is covered in a green living wall of plants." },
  { name: "Palais de Tokyo", lon: 2.29677, lat: 48.86426, look: "the Palais de Tokyo (1937): a monumental, stripped-classical building of pale limestone with flat roofs, made of two symmetrical wings facing each other across a stepped open courtyard that descends toward the Seine, the wings joined at the top by a long portico of slender square columns; a long rectangular reflecting pool and terraces in the courtyard." },
  { name: "Palais de l'Élysée", lon: 2.31673, lat: 48.87032, look: "the Palais de l'Élysée, the French president's residence: an elegant 18th-century hôtel particulier of pale cream stone with steep grey slate roofs, a main house with two wings around a gravelled cour d'honneur on the street side, closed by a monumental gateway on the Rue du Faubourg Saint-Honoré; behind the house a large private English-style park of lawns and big trees stretches toward the Avenue Gabriel." },
  { name: "UNESCO", lon: 2.30619, lat: 48.84972, look: "the UNESCO headquarters (1958, Breuer, Nervi and Zehrfuss): a huge Y-shaped building with three curving arms, seven storeys of concrete and glass with regular bands of windows, standing on concrete pilotis, its concave front facing the semicircular Place de Fontenoy; behind it a low conference hall with a pleated, folded concrete roof and side walls, and a small Japanese garden." },
  { name: "Cathédrale Alexandre-Nevsky", lon: 2.30199, lat: 48.87761, look: "the Cathédrale Saint-Alexandre-Nevsky, the Russian Orthodox cathedral on the Rue Daru: a compact church of pale cream stone in Russian-Byzantine style, crowned by five tall pointed tent-roof towers, a large central octagonal one and four smaller ones at the corners, each topped by a small gilded onion dome and an Orthodox cross; a small paved forecourt behind railings." },
  { name: "Cité de la Mode et du Design", lon: 2.36955, lat: 48.84104, look: "Les Docks, Cité de la Mode et du Design: a long four-storey concrete former warehouse on the Seine quay, wrapped by a bright lime-green tubular structure of glass and steel (the 'plug-over') that snakes along its river façade and over its roof, with a roof terrace with lawn and wooden decking." },
  { name: "Cinémathèque française", lon: 2.38244, lat: 48.83701, look: "the Cinémathèque française by Frank Gehry (1994): a sculptural building of pale cream limestone blocks whose corner facing the Parc de Bercy breaks into a tumble of tilted, curving and leaning volumes, with a zinc-clad canopy sweeping out like a lifted skirt and a jumble of zinc roofs; the side on the street is a plainer block of stone with square windows." },
  { name: "Fondation Cartier", lon: 2.33177, lat: 48.83727, look: "the Fondation Cartier by Jean Nouvel (1994): a crisp, transparent eight-storey building of glass and thin steel, with free-standing glass screen walls extending beyond it on both sides along the Boulevard Raspail, set among the dense trees of its garden which show through and reflect in the glass; flat roof." },
  { name: "Saint-Étienne-du-Mont", lon: 2.34811, lat: 48.84652, look: "the Église Saint-Étienne-du-Mont, beside the Panthéon: a late-Gothic and Renaissance church of pale stone with a steep slate roof and an unusual stacked three-tier façade (a classical portal with a triangular pediment, above it a curved pediment with a rose window, and a tall pointed gable on top), and a tall square bell tower with a small round turret and lantern on its left." },
  { name: "Saint-Paul-Saint-Louis", lon: 2.36146, lat: 48.85468, look: "the Église Saint-Paul-Saint-Louis, the Jesuit church on the Rue Saint-Antoine: a tall Baroque façade of pale stone in three stacked tiers of Corinthian columns, and behind it over the crossing a large grey slate dome on a drum with a lantern on top; a long slate-roofed nave." },
  { name: "Musée Rodin", lon: 2.31585, lat: 48.85527, look: "the Musée Rodin, the Hôtel Biron: an elegant 18th-century rococo mansion of pale stone with a grey slate mansard roof, set in a large formal garden of clipped yew cones, lawns, a rose garden, gravel paths and a long ornamental pool, with bronze sculptures on plinths." },
  { name: "Musée Picasso", lon: 2.3623, lat: 48.85983, look: "the Musée Picasso, the Hôtel Salé in the Marais: a grand 17th-century mansion of pale stone with a high grey slate roof with dormers, with a large rounded entrance courtyard in front and a garden behind." },
  { name: "Arts et Métiers", lon: 2.35563, lat: 48.86659, look: "the Musée des Arts et Métiers in the former priory of Saint-Martin-des-Champs: a Gothic church of pale stone with a tall slate roof and a rounded Romanesque apse with a small bell tower, joined to 18th-century classical stone wings with slate mansard roofs around a central courtyard." },
  { name: "Théâtre des Champs-Élysées", lon: 2.30153, lat: 48.86592, look: "the Théâtre des Champs-Élysées (1913, Auguste Perret) on the Avenue Montaigne: a crisp cubic Art Deco block with a flat, smooth white marble façade decorated with carved bas-relief panels and pilasters, a flat roof with a set-back rooftop restaurant pavilion." },
  { name: "Saint-Roch", lon: 2.3326, lat: 48.86534, look: "the Église Saint-Roch on the Rue Saint-Honoré: a long Baroque church of pale stone with a steep grey slate roof, a two-tier classical façade with paired columns and a pediment at its end on the Rue Saint-Honoré, wide front steps, and a small dome over the Lady Chapel behind the choir." },
  { name: "Viaduc des Arts", lon: 2.37786, lat: 48.84631, look: "the Viaduc des Arts on the Avenue Daumesnil: a former railway viaduct of red brick and pale stone with a long regular row of tall round arches, each arch closed by a glazed shop front, carrying on top the Coulée verte, a planted promenade with trees, shrubs and paths." },
  { name: "Bibliothèque Sainte-Geneviève", lon: 2.34611, lat: 48.84723, look: "the Bibliothèque Sainte-Geneviève (1851, Henri Labrouste) on the Place du Panthéon: a long, sober two-storey Neo-Renaissance building of pale stone, its upper floor a continuous row of tall round-arched windows, and a long pitched grey roof over the great reading room." },
  { name: "Saint-Jean de Montmartre", lon: 2.33791, lat: 48.8842, look: "the Église Saint-Jean de Montmartre on the Place des Abbesses (1904): an Art Nouveau church of exposed RED BRICK, nicknamed Saint-Jean-des-Briques, with a tall brick façade of stacked arches decorated with little turquoise ceramic studs, and a slate roof." },
  { name: "Musée Carnavalet", lon: 2.36248, lat: 48.85745, look: "the Musée Carnavalet in the Marais: the Renaissance Hôtel Carnavalet and the Hôtel Le Peletier de Saint-Fargeau, mansions of pale stone with high grey slate roofs and dormers around paved courtyards and formal gardens of clipped box hedges in geometric patterns." },
  { name: "Jacquemart-André", lon: 2.31057, lat: 48.87557, look: "the Musée Jacquemart-André on the Boulevard Haussmann: a 19th-century private mansion of pale stone set back behind a courtyard, its garden front a curved neoclassical façade with a portico of columns, slate roof." },
  { name: "Grande Arche", radius: 380, lon: 2.23577, lat: 48.89246, look: "the Grande Arche de la Défense: a gigantic hollow cube 110 m high, a colossal open window frame clad in white marble and granite with glass inner walls, slightly turned off the axis, a white tensile fabric canopy (the 'Nuage') hung inside its huge opening, and a broad flight of white steps rising to it from the esplanade" },
  { name: "CNIT", radius: 320, lon: 2.23934, lat: 48.89262, look: "the CNIT: a vast, low, triangular exhibition hall under a single curved shell of pale concrete resting on three points, like a huge billowing white triangle, its three sides closed by tall glass curtain walls" },
  { name: "Tour First", lon: 2.25161, lat: 48.88877, look: "Tour First, the tallest tower in France (231 m): a sleek tower of pale silvery-white glass with a curved, rounded-triangle plan and fine horizontal white bands, its top slightly stepped" },
  { name: "Tour Hekla", lon: 2.23509, lat: 48.88903, look: "Tour Hekla by Jean Nouvel (220 m): a faceted crystalline tower of silvery-blue glass with dense white vertical fins, its facades folded into sharp angles and its crown split into jagged glass prisms like a volcano's peak" },
  { name: "The Link", lon: 2.24789, lat: 48.88726, look: "The Link, TotalEnergies' headquarters (242 m): two slender towers of pale glass with white horizontal bands standing side by side, the taller and the shorter, joined by dozens of horizontal link platforms stacked one above another all the way up, like the rungs of a ladder" },
  { name: "Tour Majunga", lon: 2.2436, lat: 48.88888, look: "Tour Majunga (194 m): a glass tower made of three slim joined blades of different heights, its facades of reflective glass broken by a staggered pattern of recessed loggias that ripple up the tower like a wave" },
  { name: "Tour Saint-Gobain", lon: 2.24933, lat: 48.88972, look: "Tour Saint-Gobain (178 m): a tall prism of very clear, light glass made of overlapping glass scales, with a chamfered, sloping crown" },
  { name: "Tour Total Coupole", lon: 2.24347, lat: 48.89275, look: "Tour Total Coupole (187 m): five linked tower bodies of different heights, stepped like organ pipes, clad in dark grey and black polished granite and dark reflective glass" },
  { name: "Tour Areva", lon: 2.24189, lat: 48.89249, look: "Tour Areva (178 m): a perfectly square, sheer black tower of black granite and dark tinted glass, a flat top" },
  { name: "Tour Alto", lon: 2.25117, lat: 48.88938, look: "Tour Alto (160 m): a rounded tower of reflective glass that widens as it rises, wider at the top than at its base" },
  { name: "Tours Société Générale", lon: 2.23081, lat: 48.89197, look: "the twin Société Générale towers Alicante and Chassagne (167 m): two identical tall towers of dark blue-grey glass side by side on one base, each with a sharply sloping, inclined roof, next to Tour Granite, a slimmer tower of grey-green glass and pale granite bands also with a steep slanted top" },
  { name: "Tours Aillaud", lon: 2.22787, lat: 48.88892, look: "the Tours Aillaud ('Tours Nuages'): rounded, bulging residential towers with curvy outlines, covered in a mosaic of blue, white and grey cloud patterns, pierced by windows of odd shapes (round, square, star and leaf-shaped)" },
  { name: "Parc des Princes", lon: 2.253, lat: 48.8414, look: "the Parc des Princes, Paris Saint-Germain's stadium: an oval stadium ringed by fifty curved grey concrete ribs that rise around its outside like a crown, a green football pitch inside and red and blue seats; the Boulevard Périphérique runs beneath it" },
  { name: "Roland-Garros", lon: 2.2492, lat: 48.8472, look: "Roland-Garros: Court Philippe-Chatrier, a rectangular tennis stadium with steep grey stands around a bright orange clay court under a retractable roof of white fabric panels on steel trusses (open), with the round Court Suzanne-Lenglen and many outside orange clay courts around it among trees" },
  { name: "Tours Mercuriales", lon: 2.4153, lat: 48.8676, look: "the twin Tours Mercuriales (Levant and Ponant): two identical sheer rectangular towers of dark blue-grey reflective glass with a fine grid and flat tops, standing side by side at Porte de Bagnolet beside the motorway interchange" },
  { name: "Ballon Generali", lon: 2.274, lat: 48.84142, look: "the Ballon Generali: a huge white spherical tethered balloon with a red band, floating above the central lawn of the Parc André-Citroën on its cable" },
];

const lat0 = ORIGIN.lat;
const lon0 = ORIGIN.lon;

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
    if (l.tall) return false;
    const o = ownerTile(m, l);
    if (!o || (o.c === c && o.r === r)) return false;
    const [gx, gy] = landmarkPixel(m, l);
    const px = gx - c * m.step, py = gy - r * m.step, M = 250;
    return px > -M && py > -M && px < m.tile + M && py < m.tile + M;
  });
}
