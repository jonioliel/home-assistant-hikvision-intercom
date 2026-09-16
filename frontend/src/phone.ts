/** Israeli mobile presentation; explicit international numbers remain supported. */
export function mobileDisplay(value: string): string {
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.startsWith("00972")) digits = "0" + digits.slice(5);
  else if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  return /^05[0-9]{8}$/.test(digits)
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    : value;
}
