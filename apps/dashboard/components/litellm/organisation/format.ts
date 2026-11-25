const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

export const formatCount = (value: number): string =>
  integerFormatter.format(value);
