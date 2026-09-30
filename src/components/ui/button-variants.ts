import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/92",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/92",
        outline: "border-input bg-background/72 text-foreground shadow-none hover:border-border hover:bg-accent/90 hover:text-accent-foreground",
        secondary: "bg-secondary/88 text-secondary-foreground shadow-none hover:bg-secondary",
        ghost: "border-transparent bg-transparent shadow-none hover:bg-accent/88 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-xl px-3 text-xs",
        lg: "h-11 rounded-2xl px-8",
        icon: "h-10 w-10 rounded-2xl",
        "icon-sm": "h-7 w-7 shrink-0 rounded-md p-0 [&_svg]:size-3.5",
        "icon-xs": "h-6 w-6 shrink-0 rounded-md p-0 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
