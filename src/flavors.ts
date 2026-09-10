/** Real and nostalgic Pop-Tarts flavors for random selection. */
export const POPTART_FLAVORS = [
  "Frosted Strawberry",
  "Frosted Brown Sugar Cinnamon",
  "Frosted Cherry",
  "Frosted Blueberry",
  "Frosted Chocolate Fudge",
  "Frosted S'mores",
  "Frosted Cookies & Creme",
  "Frosted Wild Berry",
  "Frosted Raspberry",
  "Frosted Grape",
  "Frosted Chocolate Chip",
  "Frosted Hot Fudge Sundae",
  "Frosted Confetti Cupcake",
  "Frosted Pumpkin Pie",
  "Frosted Apple Cinnamon",
  "Unfrosted Strawberry",
  "Unfrosted Blueberry",
  "Unfrosted Brown Sugar Cinnamon",
  "Chocolate Peanut Butter",
  "Vanilla Milkshake",
] as const;

export type PoptartFlavor = (typeof POPTART_FLAVORS)[number];

export function pickRandomFlavor(): PoptartFlavor {
  const index = Math.floor(Math.random() * POPTART_FLAVORS.length);
  return POPTART_FLAVORS[index]!;
}
