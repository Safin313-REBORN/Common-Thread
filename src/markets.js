"use strict";

const CURRENCIES = [
  ["AUD", "Australian dollar", 2], ["BRL", "Brazilian real", 2, ["BR"]], ["CAD", "Canadian dollar", 2],
  ["CNY", "Chinese renminbi", 2, ["C2"]], ["CZK", "Czech koruna", 2], ["DKK", "Danish krone", 2],
  ["EUR", "Euro", 2], ["HKD", "Hong Kong dollar", 2], ["HUF", "Hungarian forint", 0],
  ["ILS", "Israeli new shekel", 2], ["JPY", "Japanese yen", 0], ["MYR", "Malaysian ringgit", 2, ["MY"]],
  ["MXN", "Mexican peso", 2], ["TWD", "New Taiwan dollar", 0], ["NZD", "New Zealand dollar", 2],
  ["NOK", "Norwegian krone", 2], ["PHP", "Philippine peso", 2], ["PLN", "Polish złoty", 2],
  ["GBP", "Pound sterling", 2], ["SGD", "Singapore dollar", 2],
  ["RUB", "Russian ruble", 2], ["SEK", "Swedish krona", 2], ["CHF", "Swiss franc", 2], ["THB", "Thai baht", 2],
  ["USD", "US dollar", 2]
].map(([code, name, minorDigits, availableCountryCodes]) => ({
  code, name, minorDigits,
  ...(availableCountryCodes ? { availableCountryCodes } : {})
}));

// Country and local currency references are kept separate from PayPal checkout
// currency. PayPal availability and supported payment directions vary by market.
const COUNTRIES = [
  ["AE", "United Arab Emirates", "AED", "USD"], ["AR", "Argentina", "ARS", "USD"],
  ["AT", "Austria", "EUR", "EUR"], ["AU", "Australia", "AUD", "AUD"],
  ["BE", "Belgium", "EUR", "EUR"], ["BG", "Bulgaria", "BGN", "EUR"], ["BR", "Brazil", "BRL", "BRL"],
  ["CA", "Canada", "CAD", "CAD"], ["CH", "Switzerland", "CHF", "CHF"],
  ["CL", "Chile", "CLP", "USD"], ["C2", "China", "CNY", "CNY"],
  ["CO", "Colombia", "COP", "USD"], ["CR", "Costa Rica", "CRC", "USD"],
  ["CZ", "Czechia", "CZK", "CZK"], ["DE", "Germany", "EUR", "EUR"],
  ["DK", "Denmark", "DKK", "DKK"], ["DO", "Dominican Republic", "DOP", "USD"],
  ["EC", "Ecuador", "USD", "USD"], ["ES", "Spain", "EUR", "EUR"],
  ["FI", "Finland", "EUR", "EUR"], ["FR", "France", "EUR", "EUR"],
  ["GB", "United Kingdom", "GBP", "GBP"], ["GR", "Greece", "EUR", "EUR"],
  ["HK", "Hong Kong", "HKD", "HKD"], ["HU", "Hungary", "HUF", "HUF"],
  ["ID", "Indonesia", "IDR", "USD"], ["IE", "Ireland", "EUR", "EUR"],
  ["IL", "Israel", "ILS", "ILS"], ["IN", "India", "INR", "USD"],
  ["IT", "Italy", "EUR", "EUR"], ["JP", "Japan", "JPY", "JPY"],
  ["KE", "Kenya", "KES", "USD"], ["KR", "South Korea", "KRW", "USD"],
  ["LK", "Sri Lanka", "LKR", "USD"], ["MX", "Mexico", "MXN", "MXN"],
  ["MY", "Malaysia", "MYR", "MYR"], ["NG", "Nigeria", "NGN", "USD"],
  ["NL", "Netherlands", "EUR", "EUR"], ["NO", "Norway", "NOK", "NOK"],
  ["NP", "Nepal", "NPR", "USD"], ["NZ", "New Zealand", "NZD", "NZD"],
  ["PH", "Philippines", "PHP", "PHP"],
  ["PL", "Poland", "PLN", "PLN"], ["PT", "Portugal", "EUR", "EUR"],
  ["RO", "Romania", "RON", "EUR"], ["RU", "Russia", "RUB", "USD"],
  ["SA", "Saudi Arabia", "SAR", "USD"], ["SE", "Sweden", "SEK", "SEK"],
  ["SG", "Singapore", "SGD", "SGD"], ["TH", "Thailand", "THB", "THB"],
  ["TW", "Taiwan", "TWD", "TWD"],
  ["US", "United States", "USD", "USD"], ["VN", "Vietnam", "VND", "USD"],
  ["ZA", "South Africa", "ZAR", "USD"]
].map(([code, name, localCurrency, defaultCheckoutCurrency]) => ({ code, name, localCurrency, defaultCheckoutCurrency }));

const currencyByCode = new Map(CURRENCIES.map((entry) => [entry.code, entry]));
const countryByCode = new Map(COUNTRIES.map((entry) => [entry.code, entry]));

function currency(code) {
  return currencyByCode.get(String(code || "").toUpperCase()) || null;
}

function country(code) {
  return countryByCode.get(String(code || "").toUpperCase()) || null;
}

module.exports = { COUNTRIES, CURRENCIES, country, currency };
