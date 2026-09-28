import { forwardRef, type ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary: "bg-accent text-accent-ink hover:brightness-110",
  quiet: "border border-line bg-panel text-ink hover:bg-paper",
  danger: "bg-danger text-white hover:brightness-110",
} as const;

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }
>(function Button({ variant = "primary", className = "", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
});
