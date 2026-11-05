import { Language } from "@/lib/ui-copy";
import { LoaderComponent } from "@/types/dot-motion";

/** What every collapsible section of the settings sidebar receives. */
export type SectionProps = {
  language: Language;
  loader: LoaderComponent;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};
