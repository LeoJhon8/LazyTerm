import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-[min(22rem,var(--radix-tooltip-content-available-width))] whitespace-pre-line break-words rounded-md border border-border/70 bg-popover px-2.5 py-1.5 text-xs font-normal leading-relaxed text-popover-foreground shadow-md backdrop-blur-xl animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none origin-(--radix-tooltip-content-transform-origin)",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

// Forward injected events and refs so this also composes with menu triggers.
const HoverTooltip = React.forwardRef<
  React.ElementRef<typeof Slot>,
  Omit<React.ComponentPropsWithoutRef<typeof Slot>, "content"> & { content?: string }
>(({ content, children, ...props }, ref) => {
  const target = <Slot ref={ref} {...props}>{children}</Slot>

  if (!content) return target

  return (
    <Tooltip>
      <TooltipTrigger asChild>{target}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  )
})
HoverTooltip.displayName = "HoverTooltip"

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, HoverTooltip }
