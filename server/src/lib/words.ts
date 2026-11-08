// Amounts in words, the Indian way (thousand, lakh, crore), for the line under a bill's total:
//   400000 paise  -> "Four Thousand Rupees Only"
//   12345050      -> "One Lakh Twenty Three Thousand Four Hundred Fifty Rupees and Fifty Paise Only"
// The same function is in client/src/words.ts so the screen and the PDF always say the same thing.

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0 to 99 */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

/** 0 to 999 */
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  return [h ? `${ONES[h]} Hundred` : "", twoDigits(n % 100)].filter(Boolean).join(" ");
}

/** A whole number in words with Indian grouping. 0 -> "Zero". Larger crores repeat the grouping ("One Hundred Crore"). */
export function numberInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("numberInWords takes a whole number 0 or more");
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${numberInWords(crore)} Crore` : "",
    lakh ? `${twoDigits(lakh)} Lakh` : "",
    thousand ? `${twoDigits(thousand)} Thousand` : "",
    threeDigits(rest),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Paise to words: "Four Thousand Rupees Only", "Four Thousand Rupees and Fifty Paise Only", "Fifty Paise Only". */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  if (rupees === 0 && p > 0) return `${twoDigits(p)} Paise Only`;
  return `${numberInWords(rupees)} ${rupees === 1 ? "Rupee" : "Rupees"}${p ? ` and ${twoDigits(p)} Paise` : ""} Only`;
}
