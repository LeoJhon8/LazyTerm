import * as React from "react";
import { Slot } from "@radix-ui/react-slot"; // 导入 Slot
import { type VariantProps } from "class-variance-authority";
import { cn } from "@/components/ui/utils";
import { buttonVariants } from "./button-variants"; // 导入刚才拆分的变量

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    // 修复 'asChild' unused: 根据 asChild 决定渲染 Slot 还是原始 button
    const Comp = asChild ? Slot : "button";
    
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };