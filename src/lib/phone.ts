// Нормализация телефонов для сравнения: только цифры, 8XXXXXXXXXX -> 7XXXXXXXXXX,
// 10 цифр -> добавляем 7 (РФ). Чтобы +7…, 8…, с пробелами/скобками совпадали.
export function normalizePhone(s: string | null | undefined): string {
  let d = (s || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  return d;
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length >= 10 && na === nb;
}
