// System category tree seeded into the Category table (userId = null,
// isSystem = true). Slugs are stable, globally unique kebab-case keys —
// mapping rows and category rules reference categories by slug, so never
// rename a slug once shipped (rename `name` instead).

export interface SeedCategory {
  slug: string; // stable kebab-case key, globally unique
  name: string; // display name
  flow: "EXPENSE" | "INCOME" | "TRANSFER";
  children?: { slug: string; name: string }[]; // children inherit flow
}

export const SYSTEM_CATEGORIES: SeedCategory[] = [
  {
    slug: "income",
    name: "Income",
    flow: "INCOME",
    children: [
      { slug: "paycheck", name: "Paycheck" },
      { slug: "interest", name: "Interest & Dividends" },
    ],
  },
  {
    slug: "transfers",
    name: "Transfers",
    flow: "TRANSFER",
  },
  {
    slug: "food-and-dining",
    name: "Food & Dining",
    flow: "EXPENSE",
    children: [
      { slug: "groceries", name: "Groceries" },
      { slug: "restaurants", name: "Restaurants" },
      { slug: "coffee", name: "Coffee Shops" },
    ],
  },
  {
    slug: "shopping",
    name: "Shopping",
    flow: "EXPENSE",
    children: [
      { slug: "clothing", name: "Clothing & Accessories" },
      { slug: "electronics", name: "Electronics" },
    ],
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    flow: "EXPENSE",
    children: [{ slug: "streaming", name: "Streaming & Media" }],
  },
  {
    slug: "transportation",
    name: "Transportation",
    flow: "EXPENSE",
    children: [
      { slug: "gas", name: "Gas" },
      { slug: "rideshare", name: "Rideshare & Taxis" },
      { slug: "public-transit", name: "Public Transit" },
      { slug: "parking", name: "Parking" },
    ],
  },
  {
    slug: "travel",
    name: "Travel",
    flow: "EXPENSE",
    children: [
      { slug: "flights", name: "Flights" },
      { slug: "lodging", name: "Lodging" },
    ],
  },
  {
    slug: "bills-and-utilities",
    name: "Bills & Utilities",
    flow: "EXPENSE",
    children: [
      { slug: "rent", name: "Rent" },
      { slug: "utilities", name: "Utilities" },
      { slug: "internet-and-phone", name: "Internet & Phone" },
    ],
  },
  {
    slug: "health",
    name: "Health",
    flow: "EXPENSE",
    children: [{ slug: "pharmacy", name: "Pharmacy" }],
  },
  {
    slug: "personal-care",
    name: "Personal Care",
    flow: "EXPENSE",
    children: [{ slug: "fitness", name: "Gym & Fitness" }],
  },
  {
    slug: "home",
    name: "Home",
    flow: "EXPENSE",
  },
  {
    slug: "loan-payments",
    name: "Loan Payments",
    flow: "EXPENSE",
    children: [
      { slug: "mortgage", name: "Mortgage" },
      { slug: "credit-card-payment", name: "Credit Card Payment" },
      { slug: "student-loan", name: "Student Loan" },
      { slug: "car-payment", name: "Car Payment" },
    ],
  },
  {
    slug: "fees",
    name: "Fees & Charges",
    flow: "EXPENSE",
  },
  {
    slug: "services",
    name: "Services",
    flow: "EXPENSE",
  },
  {
    slug: "government-and-nonprofit",
    name: "Government & Nonprofit",
    flow: "EXPENSE",
    children: [
      { slug: "taxes", name: "Taxes" },
      { slug: "donations", name: "Donations" },
    ],
  },
  {
    slug: "uncategorized",
    name: "Uncategorized",
    flow: "EXPENSE",
  },
];
