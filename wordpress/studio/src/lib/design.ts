export type Crop = { zoom: number; x: number; y: number };
export const SUITS = [["S", "♠", "pique"], ["H", "♥", "cœur"], ["D", "♦", "carreau"], ["C", "♣", "trèfle"]] as const;
export const RANKS = [["J", "V", "Valet"], ["Q", "D", "Dame"], ["K", "R", "Roi"]] as const;
