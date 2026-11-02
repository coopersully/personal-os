import * as React from "react"

import { SettingsControlsContext } from "../settings-controls-context"
import { SettingsTimeInput } from "../settings-time-input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const settings = React.useContext(SettingsControlsContext)
  if (settings && type === "time") return <SettingsTimeInput {...props} type={type} className={className} />
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-transparent bg-input-surface px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-input-placeholder hover:bg-input-surface-hover hover:placeholder:text-muted-foreground focus-visible:border-foreground/50 focus-visible:bg-selection focus-visible:placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:aria-invalid:border-destructive/50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
