const quoteRules = 'Compare signed route quotes for the same pair and input size. More base asset for the same quote amount means the base asset is cheaper. Use the saved position and order limits. HOLD when the observations are missing or the signal is unclear.';

export const routeStrategyTemplates = [
  {
    name: 'Route momentum',
    strategy: 'Compare at least two signed observations for the same route and order size. A lower base output per unit of quote currency indicates strengthening base price. BUY within the saved order cap on strengthening momentum. SELL held inventory within the saved cap when momentum reverses. HOLD if prices are unchanged, quotes are missing, or the saved risk limits prevent an order. Use quote-currency base units and never invent prices.',
  },
  {
    name: 'Route mean reversion',
    strategy: 'Use at least four recent quotes. Consider buying only after the implied price falls below the recent range and starts recovering. Reduce a held position as the price returns to its recent average. ' + quoteRules,
  },
  {
    name: 'Route breakout',
    strategy: 'Use at least five recent quotes. Consider buying only after two consecutive implied prices exceed the range of the preceding quotes. Reduce a held position if the price falls back into that range. ' + quoteRules,
  },
];
