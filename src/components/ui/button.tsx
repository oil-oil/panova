"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:opacity-50 disabled:pointer-events-none ring-offset-background cursor-pointer disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background hover:opacity-90 data-[state=open]:bg-foreground",
        ghost:
          "hover:bg-muted text-foreground",
        outline:
          "border border-input bg-background hover:bg-muted",
        subtle:
          "bg-muted text-foreground hover:bg-muted/80",
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 px-2 text-xs",
        lg: "h-10 px-4",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
