export interface Landmark {
  name: string;
  note: string;
  lon: number;
  lat: number;
  zoom: number;
  /** Height in metres to centre on, for tall things. */
  z?: number;
  /** Height of the map label above the ground. */
  top?: number;
}

export const LANDMARKS: Landmark[] = [
  // Centre: the south-west corner of the map.
  { name: "Louvre", note: "1er", lon: 2.3376, lat: 48.8606, zoom: 2.4 },
  { name: "Palais-Royal", note: "1er", lon: 2.3371, lat: 48.8638, zoom: 2.6 },
  { name: "Bourse de Commerce", note: "1er", lon: 2.3428, lat: 48.8628, zoom: 3.2 },
  { name: "Saint-Eustache", note: "1er", lon: 2.3451, lat: 48.8634, zoom: 3.2 },
  { name: "La Samaritaine", note: "1er", lon: 2.3425, lat: 48.859, zoom: 3 },
  { name: "Tour Saint-Jacques", note: "4e", lon: 2.3488, lat: 48.8579, zoom: 3.4 },
  { name: "Centre Pompidou", note: "4e", lon: 2.3522, lat: 48.8606, zoom: 2.8 },
  { name: "Palais Brongniart", note: "2e", lon: 2.3412, lat: 48.869, zoom: 3.2 },
  { name: "Opéra Garnier", note: "9e", lon: 2.3316, lat: 48.872, zoom: 2.8 },
  { name: "Galeries Lafayette", note: "9e", lon: 2.3322, lat: 48.8737, zoom: 3 },
  { name: "Porte Saint-Denis", note: "10e", lon: 2.3527, lat: 48.8698, zoom: 3.6 },
  { name: "Porte Saint-Martin", note: "10e", lon: 2.3557, lat: 48.8692, zoom: 3.6 },
  // Montmartre and the stations.
  { name: "Moulin Rouge", note: "Pigalle", lon: 2.3323, lat: 48.8841, zoom: 3.6 },
  { name: "Sacré-Cœur", note: "18e", lon: 2.3431, lat: 48.8867, zoom: 2.8, z: 30, top: 90 },
  { name: "Place du Tertre", note: "18e", lon: 2.3407, lat: 48.8865, zoom: 3.4 },
  { name: "Moulin de la Galette", note: "18e", lon: 2.3374, lat: 48.8876, zoom: 3.6 },
  { name: "Cimetière de Montmartre", note: "18e", lon: 2.3325, lat: 48.8875, zoom: 2.2 },
  { name: "Le Louxor", note: "cinéma", lon: 2.3497, lat: 48.8833, zoom: 3.6 },
  { name: "Métro 2 viaduct", note: "Barbès", lon: 2.3535, lat: 48.8839, zoom: 3.2, z: 8, top: 14 },
  { name: "Gare du Nord", note: "10e", lon: 2.3553, lat: 48.8809, zoom: 2.2 },
  { name: "Gare de l'Est", note: "10e", lon: 2.359, lat: 48.8768, zoom: 2.2 },
  { name: "Saint-Vincent-de-Paul", note: "10e", lon: 2.3519, lat: 48.8783, zoom: 3 },
  { name: "Halle Pajol", note: "18e", lon: 2.3618, lat: 48.8881, zoom: 3.2 },
  // The canals.
  { name: "Canal Saint-Martin", note: "apéro", lon: 2.3653, lat: 48.8712, zoom: 4.5 },
  { name: "Hôpital Saint-Louis", note: "10e", lon: 2.3685, lat: 48.8738, zoom: 2.8 },
  { name: "Rotonde de la Villette", note: "19e", lon: 2.3693, lat: 48.8838, zoom: 3 },
  { name: "Bassin de la Villette", note: "19e", lon: 2.3735, lat: 48.8865, zoom: 2.2 },
  { name: "Parc de la Villette", note: "19e", lon: 2.3905, lat: 48.8925, zoom: 1.8 },
  { name: "Cité des Sciences", note: "La Géode", lon: 2.388, lat: 48.8955, zoom: 2.6 },
  { name: "Grande Halle", note: "Villette", lon: 2.3905, lat: 48.8907, zoom: 2.8 },
  { name: "Philharmonie", note: "concerts", lon: 2.3942, lat: 48.8918, zoom: 2.8 },
  { name: "Le Zénith", note: "concerts", lon: 2.3935, lat: 48.8941, zoom: 3 },
  // East: Belleville, Ménilmontant, République.
  { name: "Buttes-Chaumont", note: "19e", lon: 2.3826, lat: 48.8809, zoom: 1.8 },
  { name: "Place des Fêtes", note: "19e", lon: 2.3928, lat: 48.8768, zoom: 2.6 },
  { name: "Saint-Jean-Baptiste", note: "Belleville", lon: 2.3836, lat: 48.8745, zoom: 3.2 },
  { name: "Rue Dénoyez", note: "street art", lon: 2.378, lat: 48.8718, zoom: 4.5 },
  { name: "Parc de Belleville", note: "20e", lon: 2.3848, lat: 48.8716, zoom: 2.4 },
  { name: "Notre-Dame-de-la-Croix", note: "Ménilmontant", lon: 2.3864, lat: 48.8691, zoom: 3.2 },
  { name: "Place de la République", note: "manif", lon: 2.3631, lat: 48.8675, zoom: 4 },
  { name: "Cirque d'Hiver", note: "11e", lon: 2.3667, lat: 48.8628, zoom: 3.2 },
  { name: "Père-Lachaise", note: "20e", lon: 2.3935, lat: 48.8614, zoom: 1.8 },
];
