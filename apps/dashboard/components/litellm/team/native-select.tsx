import type { ComponentProps } from "react";

import { NativeSelect } from "@/components/ui/native-select";

// Team forms keep this import path; the select itself is the shared
// components/ui/native-select (Design System - Component Inventory).
function Select(props: ComponentProps<"select">) {
  return <NativeSelect {...props} />;
}

export { Select as NativeSelect };
