// Plaid personal_finance_category (PFC) -> app category mapping (D-009).
//
// Taxonomy source: Plaid's published personal_finance_category CSV
// (https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv).
//
// Resolution order at categorization time:
//   1. exact match on the transaction's detailed code (rows below where
//      plaidDetailed is a detailed code, e.g. FOOD_AND_DRINK_COFFEE)
//   2. fallback to the primary-level row, where plaidDetailed is the primary
//      code itself (e.g. FOOD_AND_DRINK) — one such row exists for every
//      Plaid PFC primary, so unknown or unmapped detailed codes always
//      resolve to a sensible parent category.
//
// Only detailed codes confirmed against Plaid's taxonomy are listed; anything
// else intentionally falls back to its primary.

export interface SeedMapping {
  plaidDetailed: string; // Plaid PFC detailed code, OR a primary code acting as primary-level fallback
  plaidPrimary: string; // Plaid PFC primary code
  categorySlug: string; // must exist in SYSTEM_CATEGORIES (parent or child slug)
}

export const PLAID_CATEGORY_MAPPING: SeedMapping[] = [
  // --- Primary-level fallbacks (one per Plaid PFC primary) ---
  { plaidDetailed: "INCOME", plaidPrimary: "INCOME", categorySlug: "income" },
  { plaidDetailed: "TRANSFER_IN", plaidPrimary: "TRANSFER_IN", categorySlug: "transfers" },
  { plaidDetailed: "TRANSFER_OUT", plaidPrimary: "TRANSFER_OUT", categorySlug: "transfers" },
  { plaidDetailed: "LOAN_PAYMENTS", plaidPrimary: "LOAN_PAYMENTS", categorySlug: "loan-payments" },
  { plaidDetailed: "BANK_FEES", plaidPrimary: "BANK_FEES", categorySlug: "fees" },
  { plaidDetailed: "ENTERTAINMENT", plaidPrimary: "ENTERTAINMENT", categorySlug: "entertainment" },
  { plaidDetailed: "FOOD_AND_DRINK", plaidPrimary: "FOOD_AND_DRINK", categorySlug: "food-and-dining" },
  { plaidDetailed: "GENERAL_MERCHANDISE", plaidPrimary: "GENERAL_MERCHANDISE", categorySlug: "shopping" },
  { plaidDetailed: "HOME_IMPROVEMENT", plaidPrimary: "HOME_IMPROVEMENT", categorySlug: "home" },
  { plaidDetailed: "MEDICAL", plaidPrimary: "MEDICAL", categorySlug: "health" },
  { plaidDetailed: "PERSONAL_CARE", plaidPrimary: "PERSONAL_CARE", categorySlug: "personal-care" },
  { plaidDetailed: "GENERAL_SERVICES", plaidPrimary: "GENERAL_SERVICES", categorySlug: "services" },
  {
    plaidDetailed: "GOVERNMENT_AND_NON_PROFIT",
    plaidPrimary: "GOVERNMENT_AND_NON_PROFIT",
    categorySlug: "government-and-nonprofit",
  },
  { plaidDetailed: "TRANSPORTATION", plaidPrimary: "TRANSPORTATION", categorySlug: "transportation" },
  { plaidDetailed: "TRAVEL", plaidPrimary: "TRAVEL", categorySlug: "travel" },
  {
    plaidDetailed: "RENT_AND_UTILITIES",
    plaidPrimary: "RENT_AND_UTILITIES",
    categorySlug: "bills-and-utilities",
  },

  // --- Detailed-level refinements ---

  // INCOME
  { plaidDetailed: "INCOME_WAGES", plaidPrimary: "INCOME", categorySlug: "paycheck" },
  { plaidDetailed: "INCOME_INTEREST_EARNED", plaidPrimary: "INCOME", categorySlug: "interest" },
  { plaidDetailed: "INCOME_DIVIDENDS", plaidPrimary: "INCOME", categorySlug: "interest" },

  // FOOD_AND_DRINK
  { plaidDetailed: "FOOD_AND_DRINK_GROCERIES", plaidPrimary: "FOOD_AND_DRINK", categorySlug: "groceries" },
  { plaidDetailed: "FOOD_AND_DRINK_RESTAURANT", plaidPrimary: "FOOD_AND_DRINK", categorySlug: "restaurants" },
  { plaidDetailed: "FOOD_AND_DRINK_FAST_FOOD", plaidPrimary: "FOOD_AND_DRINK", categorySlug: "restaurants" },
  { plaidDetailed: "FOOD_AND_DRINK_COFFEE", plaidPrimary: "FOOD_AND_DRINK", categorySlug: "coffee" },

  // GENERAL_MERCHANDISE
  {
    plaidDetailed: "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
    plaidPrimary: "GENERAL_MERCHANDISE",
    categorySlug: "clothing",
  },
  {
    plaidDetailed: "GENERAL_MERCHANDISE_ELECTRONICS",
    plaidPrimary: "GENERAL_MERCHANDISE",
    categorySlug: "electronics",
  },

  // ENTERTAINMENT
  { plaidDetailed: "ENTERTAINMENT_TV_AND_MOVIES", plaidPrimary: "ENTERTAINMENT", categorySlug: "streaming" },
  { plaidDetailed: "ENTERTAINMENT_MUSIC_AND_AUDIO", plaidPrimary: "ENTERTAINMENT", categorySlug: "streaming" },

  // TRANSPORTATION
  { plaidDetailed: "TRANSPORTATION_GAS", plaidPrimary: "TRANSPORTATION", categorySlug: "gas" },
  {
    plaidDetailed: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
    plaidPrimary: "TRANSPORTATION",
    categorySlug: "rideshare",
  },
  {
    plaidDetailed: "TRANSPORTATION_PUBLIC_TRANSIT",
    plaidPrimary: "TRANSPORTATION",
    categorySlug: "public-transit",
  },
  { plaidDetailed: "TRANSPORTATION_PARKING", plaidPrimary: "TRANSPORTATION", categorySlug: "parking" },

  // TRAVEL
  { plaidDetailed: "TRAVEL_FLIGHTS", plaidPrimary: "TRAVEL", categorySlug: "flights" },
  { plaidDetailed: "TRAVEL_LODGING", plaidPrimary: "TRAVEL", categorySlug: "lodging" },

  // RENT_AND_UTILITIES
  { plaidDetailed: "RENT_AND_UTILITIES_RENT", plaidPrimary: "RENT_AND_UTILITIES", categorySlug: "rent" },
  {
    plaidDetailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    plaidPrimary: "RENT_AND_UTILITIES",
    categorySlug: "utilities",
  },
  { plaidDetailed: "RENT_AND_UTILITIES_WATER", plaidPrimary: "RENT_AND_UTILITIES", categorySlug: "utilities" },
  {
    plaidDetailed: "RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT",
    plaidPrimary: "RENT_AND_UTILITIES",
    categorySlug: "utilities",
  },
  {
    plaidDetailed: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
    plaidPrimary: "RENT_AND_UTILITIES",
    categorySlug: "internet-and-phone",
  },
  {
    plaidDetailed: "RENT_AND_UTILITIES_TELEPHONE",
    plaidPrimary: "RENT_AND_UTILITIES",
    categorySlug: "internet-and-phone",
  },

  // MEDICAL
  {
    plaidDetailed: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
    plaidPrimary: "MEDICAL",
    categorySlug: "pharmacy",
  },

  // PERSONAL_CARE
  {
    plaidDetailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
    plaidPrimary: "PERSONAL_CARE",
    categorySlug: "fitness",
  },

  // LOAN_PAYMENTS
  {
    plaidDetailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
    plaidPrimary: "LOAN_PAYMENTS",
    categorySlug: "mortgage",
  },
  {
    plaidDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    plaidPrimary: "LOAN_PAYMENTS",
    categorySlug: "credit-card-payment",
  },
  {
    plaidDetailed: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
    plaidPrimary: "LOAN_PAYMENTS",
    categorySlug: "student-loan",
  },
  { plaidDetailed: "LOAN_PAYMENTS_CAR_PAYMENT", plaidPrimary: "LOAN_PAYMENTS", categorySlug: "car-payment" },

  // GOVERNMENT_AND_NON_PROFIT
  {
    plaidDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    plaidPrimary: "GOVERNMENT_AND_NON_PROFIT",
    categorySlug: "taxes",
  },
  {
    plaidDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
    plaidPrimary: "GOVERNMENT_AND_NON_PROFIT",
    categorySlug: "donations",
  },
];
