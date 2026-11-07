import { useState } from "react";
import { applyTheme, getThemeChoice, type ThemeChoice } from "../theme";
import Icon from "./Icon";
import Segmented from "./Segmented";

export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice);
  return (
    <Segmented
      icons
      label="Colour theme"
      value={choice}
      onChange={(next) => {
        setChoice(next);
        applyTheme(next);
      }}
      options={[
        { value: "system", label: <Icon name="display" />, aria: "Use the device setting" },
        { value: "light", label: <Icon name="sun" />, aria: "Light theme" },
        { value: "dark", label: <Icon name="moon" />, aria: "Dark theme" },
      ]}
    />
  );
}
