"use client";

import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt";
import type { ReactElement } from "react";

export function HeaderTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function HexlyLink() {
  return (
    <HeaderTooltip label="Otter on hexly.ai">
      <Button variant="ghost" size="icon" asChild>
        <a
          href="https://hexly.ai/projects/otter"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Otter on hexly.ai (opens in a new tab)"
        >
          <span className="sr-only">Otter on hexly.ai</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path
              d="m12 2 8.66 5v10L12 22l-8.66-5V7Z"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 2v20M3.34 7l17.32 10m0-10L3.34 17"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </Button>
    </HeaderTooltip>
  );
}
