import { LoaderIcon } from "@/components/icons"
import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderIcon
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      data-slot="spinner"
      role="status"
      {...props}
    />
  )
}

export { Spinner }
