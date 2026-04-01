import { cva, type VariantProps } from "class-variance-authority"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none active:scale-[0.98] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-brand-700",
        secondary: "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800",
        outline:
          "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900",
        ghost:
          "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        destructive:
          "bg-red-600 text-white shadow-sm hover:bg-red-700",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 gap-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 px-3 gap-1.5 text-xs",
        lg: "h-12 px-6 gap-2 text-base",
        icon: "h-10 w-10 p-0",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export { buttonVariants }
export type { VariantProps }
