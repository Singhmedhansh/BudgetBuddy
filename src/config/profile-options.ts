/** Choices offered in profile and preference forms. The database enforces the same value sets. */
export const COUNTRIES: { code: string; name: string }[] = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["AE", "United Arab Emirates"], ["SG", "Singapore"],
  ["AU", "Australia"], ["CA", "Canada"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"], ["IE", "Ireland"],
  ["ES", "Spain"], ["IT", "Italy"], ["SE", "Sweden"], ["CH", "Switzerland"], ["NZ", "New Zealand"], ["JP", "Japan"],
  ["KR", "South Korea"], ["HK", "Hong Kong"], ["MY", "Malaysia"], ["ID", "Indonesia"], ["TH", "Thailand"], ["PH", "Philippines"],
  ["VN", "Vietnam"], ["BD", "Bangladesh"], ["LK", "Sri Lanka"], ["NP", "Nepal"], ["PK", "Pakistan"], ["SA", "Saudi Arabia"],
  ["QA", "Qatar"], ["KW", "Kuwait"], ["OM", "Oman"], ["BH", "Bahrain"], ["ZA", "South Africa"], ["NG", "Nigeria"], ["KE", "Kenya"],
  ["EG", "Egypt"], ["BR", "Brazil"], ["MX", "Mexico"], ["AR", "Argentina"], ["PL", "Poland"], ["PT", "Portugal"], ["BE", "Belgium"],
  ["AT", "Austria"], ["DK", "Denmark"], ["NO", "Norway"], ["FI", "Finland"],
].map(([code, name]) => ({ code, name }));

export const DATE_FORMATS = [
  { value: "dmy", label: "Day first", example: "13 Nov 2026" },
  { value: "mdy", label: "Month first", example: "Nov 13, 2026" },
  { value: "ymd", label: "Year first", example: "2026-11-13" },
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number]["value"];

export const NUMBER_FORMATS = [
  { value: "en-IN", label: "Indian grouping", example: "1,23,456.78" },
  { value: "en-US", label: "International", example: "123,456.78" },
  { value: "de-DE", label: "European, comma decimal", example: "123.456,78" },
  { value: "fr-FR", label: "Spaced groups, comma decimal", example: "123 456,78" },
] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number]["value"];

export const PERSONAS = [
  { value: "student", label: "Student" },
  { value: "professional", label: "Working professional" },
  { value: "household", label: "Household or family" },
  { value: "other", label: "Something else" },
] as const;
