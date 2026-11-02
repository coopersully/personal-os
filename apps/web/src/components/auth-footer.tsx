import { ChevronDownIcon } from "./icons.js";
import { Button } from "./ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";

const helpLinks = [
  { href: "/about/", label: "About" },
  { href: "/docs/", label: "Guide" },
  { href: "/support/", label: "Support" },
];
const legalLinks = [
  { href: "/privacy/", label: "Privacy Policy" },
  { href: "/terms/", label: "Terms of Use" },
  { href: "/data-use/", label: "Data Use" },
  { href: "/sms/", label: "SMS Policy" },
];

function FooterMenu({ label, links }: { label: string; links: typeof helpLinks }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal text-[var(--content-tertiary)]">
          {label}
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuGroup>
          {links.map((link) => (
            <DropdownMenuItem key={link.href} asChild>
              <a href={link.href}>{link.label}</a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AuthFooter() {
  return (
    <div className="auth-footer">
      <nav
        aria-label="About nohmi and policies"
        className="flex flex-nowrap items-center gap-1 whitespace-nowrap text-sm text-[var(--content-tertiary)]"
      >
        <div className="auth-footer__links flex items-center gap-1">
          {helpLinks.map((link) => (
            <Button
              key={link.href}
              variant="ghost"
              size="sm"
              asChild
              className="font-normal text-[var(--content-tertiary)]"
            >
              <a href={link.href}>{link.label}</a>
            </Button>
          ))}
        </div>
        <div className="auth-footer__help">
          <FooterMenu label="Help" links={helpLinks} />
        </div>
        <FooterMenu label="Legal" links={legalLinks} />
      </nav>
    </div>
  );
}
