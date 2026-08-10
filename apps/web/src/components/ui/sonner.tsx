import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { AlertTriangleIcon, CircleCheckIcon, InfoIcon, LoaderIcon, ErrorIcon } from "@/components/icons";

const Toaster = ({ theme, ...props }: ToasterProps) => {
  const { theme: resolvedTheme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme ?? (resolvedTheme as NonNullable<ToasterProps["theme"]>)}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <AlertTriangleIcon className="size-4" />
        ),
        error: (
          <ErrorIcon className="size-4" />
        ),
        loading: (
          <LoaderIcon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
