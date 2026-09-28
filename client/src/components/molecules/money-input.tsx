import { Input } from "@/components/atoms/fields";

export function MoneyInput({
  id,
  value,
  onChange,
  currency,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  currency: string;
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      pattern="[0-9]*"
      value={value}
      aria-describedby={`${id}-hint`}
      onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ""))}
      placeholder={`Minor units of ${currency}`}
    />
  );
}
