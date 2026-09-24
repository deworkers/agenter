const cyrillic = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const latin = ["a", "b", "v", "g", "d", "e", "yo", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "yu", "ya"];

export function skillIdFromName(name: string): string {
  return [...name.toLowerCase()].map((character) => {
    const index = cyrillic.indexOf(character);
    return index < 0 ? character : latin[index];
  }).join("").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/g, "");
}
