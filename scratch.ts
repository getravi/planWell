import { create, all } from "mathjs";
const math = create(all);
const ctx = {
  COGS: 100,
  OpEx: 50,
  revenue: 500,
  accounts: {
    "Gross Margin": 400,
  },
};
console.log(math.evaluate("revenue - COGS - OpEx", ctx));
console.log(math.evaluate("accounts['Gross Margin'] * 2", ctx));
