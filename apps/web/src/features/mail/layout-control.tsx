import { getDefaultWorkspacePreferences } from "@personal-os/domain";
import { ActionButton } from "@/components/action-button";
import { ListChecksIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsFeedbackContext } from "@/lib/settings-feedback";
import { useMailLayoutPreferences } from "./layout-preferences";
import { type MailListDensity, mailListDensities } from "./mail";

/** Render inside the header's options tree so nested menu selection stays mounted. */
export function MailLayoutControl() {
  return (
    <SettingsFeedbackContext.Provider value>
      <MailLayoutOptions />
    </SettingsFeedbackContext.Provider>
  );
}

function MailLayoutOptions() {
  const { settings, save } = useMailLayoutPreferences();
  const defaults = getDefaultWorkspacePreferences("mail");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          aria-label="Message list layout"
          size="icon"
          variant="ghost"
          disabled={!settings.isSuccess || save.isWorkspacePending || !!save.recovery}
        >
          <ListChecksIcon />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="mail-density-menu">
        <DropdownMenuLabel>Conversation layout</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={
            settings.data?.preferences.mailConversationLayout ?? defaults.mailConversationLayout
          }
          onValueChange={(value) =>
            save.mutate({ mailConversationLayout: value as "split" | "single" })
          }
        >
          <DropdownMenuRadioItem value="split">Split view</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="single">Full-width view</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Conversation density</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings.data?.preferences.mailListDensity ?? defaults.mailListDensity}
          onValueChange={(value) => save.mutate({ mailListDensity: value as MailListDensity })}
        >
          {mailListDensities.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
