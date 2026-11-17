"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { DEFAULT_PRESET } from "@/lib/date-range";
import type { DateRangePreset } from "@/lib/date-range";

// System Architecture — "Configuration file" (display.defaultDateRange, A11):
// the server resolves the preset from config.yaml and passes it down here;
// client code never imports the server-only loader (Rule 10).
type Preset = Exclude<DateRangePreset, "custom">;

const DefaultPresetContext = createContext<Preset>(DEFAULT_PRESET);

export function DefaultPresetProvider({
  preset,
  children,
}: {
  preset: Preset;
  children: ReactNode;
}) {
  return (
    <DefaultPresetContext.Provider value={preset}>
      {children}
    </DefaultPresetContext.Provider>
  );
}

export function useDefaultPreset(): Preset {
  return useContext(DefaultPresetContext);
}
