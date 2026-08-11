// Денежные расчёты в копейках, чтобы избежать ошибок плавающей точки.
export function toCents(x: number | string): number {
  return Math.round(Number(x) * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// умножить сумму (в копейках) на долю (например 1/3) и округлить до копейки
export function applyRate(cents: number, rate: number): number {
  return Math.round(cents * rate);
}
