export interface Palette {
  wallA: string;
  wallB: string;
  roof: string;
}

export interface Theme {
  name: "day" | "night";
  ground: string;
  slabLeft: string;
  slabRight: string;
  road: string;
  sidewalk: string;
  path: string;
  park: string;
  pitch: string;
  cemetery: string;
  rail: string;
  water: string;
  bridge: string;
  shadow: string;
  treeShadow: string;
  tree: string;
  treeLight: string;
  /** Façade tones per building style as [lit side, shaded side]; each building picks one. */
  walls: Record<"stone" | "brick" | "modern" | "recent", [string, string][]>;
  /** Roof tones per covering as [top, mansard lit, mansard shaded]. */
  roofs: Record<"zinc" | "slate" | "tile" | "flat" | "glass", [string, string, string][]>;
  roofEdge: string;
  window: string;
  windowLit: string;
  shop: string;
  balcony: string;
  white: Palette;
  hover: Palette;
  selected: Palette;
  cars: string[];
  carGlass: string;
  headlight: string | null;
  taillight: string | null;
  label: string;
  labelText: string;
}

export const DAY: Theme = {
  name: "day",
  ground: "#e9e1d0",
  slabLeft: "#b89c74",
  slabRight: "#9a7f5c",
  road: "#a9a7a3",
  sidewalk: "#ddd6c8",
  path: "#ece4d3",
  park: "#9cc46c",
  pitch: "#b7d688",
  cemetery: "#b9c49a",
  rail: "#8f877c",
  water: "#5fa8d3",
  bridge: "#d9cfba",
  shadow: "rgba(45, 45, 75, 0.2)",
  treeShadow: "rgba(45, 45, 75, 0.16)",
  tree: "#4f9140",
  treeLight: "#79b653",
  walls: {
    stone: [
      ["#f3e9d2", "#d9c7a2"],
      ["#efe3c9", "#d2bf98"],
      ["#f5eee0", "#dcd0b8"],
      ["#ece0c6", "#cdb994"],
      ["#f1e4cc", "#d6c19b"],
    ],
    brick: [
      ["#b5634a", "#904b37"],
      ["#a8573f", "#86432f"],
      ["#bf7458", "#9a5a43"],
    ],
    modern: [
      ["#eeede8", "#c9c8c1"],
      ["#e4e2dc", "#bdbbb3"],
      ["#e9e4da", "#c4bdb0"],
      ["#dcdad5", "#b3b1aa"],
    ],
    recent: [
      ["#f7f6f2", "#d6d4ce"],
      ["#efece5", "#cbc7bd"],
    ],
  },
  roofs: {
    zinc: [
      ["#a6b1bf", "#8693a5", "#6c798c"],
      ["#9aa6b5", "#7f8c9e", "#677386"],
      ["#b0b8c3", "#8e99a9", "#748094"],
      ["#8f9aab", "#7a8698", "#626e80"],
    ],
    slate: [["#6c7480", "#5a616c", "#4a5059"]],
    tile: [["#c98a6b", "#b4775b", "#99644c"], ["#bf7a5c", "#a6684e", "#8c5742"]],
    flat: [["#c3c0b8", "#aaa79f", "#95928a"], ["#b5b2aa", "#9e9b93", "#8a877f"], ["#cbc8c1", "#b2afa7", "#9c9991"]],
    glass: [["#b9d3df", "#8fb0c0", "#7896a5"]],
  },
  roofEdge: "rgba(50, 55, 75, 0.35)",
  window: "#5d6b80",
  windowLit: "#5d6b80",
  shop: "#6e5a4c",
  balcony: "rgba(45, 45, 55, 0.55)",
  white: { wallA: "#fbfaf4", wallB: "#e3e0d4", roof: "#f0eee6" },
  hover: { wallA: "#fff6dd", wallB: "#ecd9ae", roof: "#e9a25f" },
  selected: { wallA: "#ffe9c2", wallB: "#f0c98a", roof: "#e0663f" },
  cars: ["#f4f4f2", "#2b2d33", "#8d939b", "#c7ccd2", "#b8352e", "#2f5d9e", "#e2b33c", "#3f6b4a"],
  carGlass: "#3b4a5c",
  headlight: null,
  taillight: null,
  label: "#1f2c6b",
  labelText: "#ffffff",
};

export const NIGHT: Theme = {
  name: "night",
  ground: "#2b3049",
  slabLeft: "#1f2236",
  slabRight: "#171a2a",
  road: "#3d4260",
  sidewalk: "#353a54",
  path: "#3a3f58",
  park: "#2d4a3c",
  pitch: "#365646",
  cemetery: "#33443c",
  rail: "#5a5f7a",
  water: "#1c3358",
  bridge: "#4a4f6a",
  shadow: "rgba(0, 0, 10, 0.22)",
  treeShadow: "rgba(0, 0, 10, 0.25)",
  tree: "#2c5240",
  treeLight: "#3c6a50",
  walls: {
    stone: [
      ["#4b4664", "#38344f"],
      ["#48435f", "#36324c"],
      ["#4f4a68", "#3b3753"],
    ],
    brick: [["#5a3a45", "#452c36"], ["#553844", "#412a33"]],
    modern: [["#555a6e", "#41455a"], ["#50556a", "#3d4155"]],
    recent: [["#5b6074", "#464a5e"]],
  },
  roofs: {
    zinc: [
      ["#3a4259", "#2e3449", "#252a3c"],
      ["#363d53", "#2b3145", "#232838"],
    ],
    slate: [["#2f3446", "#262a3a", "#1e2230"]],
    tile: [["#4a3640", "#3c2c35", "#30232b"]],
    flat: [["#3f4458", "#33384a", "#2a2e3e"]],
    glass: [["#5d7a96", "#4a6582", "#3c536c"]],
  },
  roofEdge: "rgba(0, 0, 0, 0.35)",
  window: "#2a2840",
  windowLit: "#ffd27a",
  shop: "#f0b45c",
  balcony: "rgba(0, 0, 0, 0.4)",
  white: { wallA: "#d9d6ea", wallB: "#b9b5d0", roof: "#c9c6dc" },
  hover: { wallA: "#6a6290", wallB: "#575078", roof: "#c7884a" },
  selected: { wallA: "#7a6a9a", wallB: "#63558a", roof: "#e0663f" },
  cars: ["#5c5f6e", "#2a2c35", "#4a4e5c", "#6a6e7c", "#7a3a3a", "#36507a"],
  carGlass: "#1d2233",
  headlight: "#fff3c4",
  taillight: "#ff4a3d",
  label: "#1f2c6b",
  labelText: "#f6eed8",
};
