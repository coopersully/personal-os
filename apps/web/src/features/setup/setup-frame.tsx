import type { ReactNode } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

export type SetupFrameProps = {
  back?: (() => void) | undefined;
  children: ReactNode;
  continueDisabled?: boolean;
  currentStep: number;
  exit: () => void;
  forward?: (() => void) | undefined;
  pending?: boolean;
  totalSteps: number;
};

export function SetupFrame({
  back,
  children,
  continueDisabled = false,
  currentStep,
  exit,
  forward,
  pending = false,
  totalSteps,
}: SetupFrameProps) {
  return (
    <main className="setup-shell">
      <header className="setup-header">
        <div
          aria-label="Setup progress"
          aria-valuemax={totalSteps}
          aria-valuemin={1}
          aria-valuenow={currentStep}
          className="setup-progress__track"
          role="progressbar"
        >
          <span style={{ transform: `scaleX(${currentStep / totalSteps})` }} />
        </div>
        <Button disabled={pending} onClick={exit} variant="ghost">
          Exit Setup
        </Button>
      </header>
      <section className="setup-stage">{children}</section>
      {back || forward ? (
        <nav aria-label="Setup navigation" className="setup-navigation">
          <span aria-hidden="true" className="setup-navigation__fade" />
          {back ? (
            <Button
              aria-label="Back"
              className="setup-navigation__button setup-navigation__button--back"
              disabled={pending}
              onClick={back}
              size="icon"
              variant="secondary"
            >
              <ArrowLeftIcon />
            </Button>
          ) : (
            <span />
          )}
          {forward ? (
            <Button
              aria-label="Continue"
              className="setup-navigation__button setup-navigation__button--forward"
              disabled={pending || continueDisabled}
              onClick={forward}
              size="icon"
            >
              <ArrowRightIcon />
            </Button>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
