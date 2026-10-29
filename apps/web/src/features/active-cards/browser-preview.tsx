import "@fontsource-variable/geist";
import "../../styles.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ListChecksIcon, MonitorIcon, PaintBrushIcon, SparklesIcon } from "@/components/icons";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsPageLayout } from "../settings/settings-layout";
import { ActiveCardsSettingsPreview } from "./settings-preview";

const dark = matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle("dark", dark);
document.documentElement.style.colorScheme = dark ? "dark" : "light";
const root = document.getElementById("root");
if (!root) throw new Error("Active cards preview root is missing");
createRoot(root).render(
  <BrowserRouter>
    <TooltipProvider>
      <div className="active-card-review-shell">
        <aside className="active-card-review-sidebar" aria-label="Settings navigation preview">
          <a href="/active-cards-settings.html" className="active-card-review-brand">
            nohmi<span>Settings</span>
          </a>
          <span className="active-card-review-section">App</span>
          <span className="active-card-review-nav">
            <PaintBrushIcon />
            Appearance
          </span>
          <a
            className="active-card-review-nav"
            href="/active-cards-settings.html"
            aria-current="page"
          >
            <ListChecksIcon />
            Active cards
          </a>
          <span className="active-card-review-nav">
            <MonitorIcon />
            Desktop app
          </span>
          <span className="active-card-review-nav">
            <SparklesIcon />
            Desktop pet
          </span>
          <p className="active-card-review-sidebar-note">
            Design preview
            <br />
            Sample cards · no account required
          </p>
        </aside>
        <main>
          <SettingsPageLayout
            title="Active cards"
            description="Make room for what needs doing. Shape your cards and try them here."
            search={null}
          >
            <ActiveCardsSettingsPreview />
          </SettingsPageLayout>
        </main>
      </div>
      <Toaster />
    </TooltipProvider>
  </BrowserRouter>,
);
