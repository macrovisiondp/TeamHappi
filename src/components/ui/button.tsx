import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-forest text-white shadow-sm hover:bg-forest-strong disabled:hover:bg-forest",
        secondary:
          "border border-line-strong/60 bg-surface text-ink shadow-sm hover:bg-surface-muted",
        ghost: "text-ink hover:bg-sage",
        danger: "bg-danger text-white shadow-sm hover:bg-danger/90",
        link: "h-auto px-0 text-forest underline-offset-4 hover:underline",
      },
      size: {
        md: "h-11 px-4",
        sm: "h-10 px-3",
        lg: "h-12 px-6 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Explains why a disabled action is unavailable (shown as a tooltip and to screen readers). */
    disabledReason?: string;
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  disabled,
  disabledReason,
  title,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : title}
      aria-description={disabled && disabledReason ? disabledReason : undefined}
      {...props}
    />
  );
}

export { Button, buttonVariants };
