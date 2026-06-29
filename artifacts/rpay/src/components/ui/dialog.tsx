import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * DialogContent — mobile-first scrollable modal.
 *
 * Architecture (why each layer exists):
 *
 * 1. DialogOverlay — dark bg-black/80 backdrop, non-interactive for scroll.
 *
 * 2. Outer scroll wrapper (fixed inset-0 overflow-y-auto overscroll-contain):
 *    Safety net: if content somehow grows beyond max-h, this catches it.
 *    overscroll-contain: prevents body scroll-chaining on iOS.
 *
 * 3. Inner flex row (min-h-[100dvh] items-start sm:items-center p-4):
 *    - min-h-[100dvh]: ensures the flex area fills viewport so centering works.
 *    - items-start: modal begins at top on small/Fold screens — user scrolls DOWN.
 *    - sm:items-center: vertically centered on tablet/desktop.
 *    - p-4: 16px breathing room on all sides.
 *
 * 4. DialogPrimitive.Content (flex flex-col max-h-[calc(100dvh-32px)] overflow-y-auto):
 *    THIS IS THE KEY FIX — overflow-y-auto must be on the element that Radix
 *    focuses and traps events inside. Previous fix put it on the outer wrapper
 *    which Radix's focus-trap bypasses on mobile touch events.
 *    - max-h-[calc(100dvh-32px)]: caps at viewport minus the 2×p-4 padding.
 *    - overflow-y-auto: the content box itself scrolls — touch events work.
 *    - overscroll-contain: no bounce/chain to background on iOS.
 *    - flex flex-col: header stacks above body above footer; allows flex-1
 *      children (internal scrollable sections used by large modals) to work.
 *    - w-[calc(100vw-32px)] sm:w-full: 95vw-equivalent on mobile, full on sm+.
 *    - sm:max-w-lg: caps width on desktop.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain">
      <div className="flex min-h-[100dvh] items-start justify-center p-4 sm:items-center">
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "relative flex flex-col",
            "w-[calc(100vw-32px)] sm:w-full sm:max-w-lg",
            "max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain",
            "gap-4 border bg-background p-6 shadow-lg rounded-lg",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            className
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </div>
    </div>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
