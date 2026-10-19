// --- Settings: a round button and its native popover (language, theme, palette, debug view) ---

import { useAtom, useSetAtom } from "jotai";
import { Settings as SettingsGlyph } from "lucide";
import { t } from "../lib/i18n";
import { paletteAtom, showTabAtom, targetLanguageAtom, themeAtom } from "../state/ui";
import { Icon } from "./Icon";

export function Settings() {
  const [lang, setLang] = useAtom(targetLanguageAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  const [palette, setPalette] = useAtom(paletteAtom);
  const showTab = useSetAtom(showTabAtom);

  return (
    <>
      <button
        type="button"
        className="fab fab-settings"
        popoverTarget="settings"
        aria-label={t("settings.title", lang)}
      >
        <Icon node={SettingsGlyph} />
      </button>
      <div id="settings" popover="auto" className="settings">
        <h2 className="micro">{t("settings.title", lang)}</h2>
        <Segmented
          legend={t("settings.language", lang)}
          name="lang"
          value={lang}
          options={[
            ["fr", "FR"],
            ["en", "EN"],
          ]}
          onChange={setLang}
        />
        <Segmented
          legend={t("settings.theme", lang)}
          name="theme"
          value={theme}
          options={[
            ["light", t("settings.light", lang)],
            ["dark", t("settings.dark", lang)],
          ]}
          onChange={setTheme}
        />
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            aria-checked={palette === "cvd"}
            checked={palette === "cvd"}
            onChange={(e) => setPalette(e.target.checked ? "cvd" : "default")}
          />
          {t("settings.palette", lang)}
        </label>
        <button
          type="button"
          className="btn"
          popoverTarget="settings"
          popoverTargetAction="hide"
          onClick={() => showTab("debug")}
        >
          {t("settings.debug", lang)}
        </button>
      </div>
    </>
  );
}

/** Exclusive choice as native radios: arrow keys and labels for free */
function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="setting">
      <legend className="micro">{legend}</legend>
      <div className="segmented">
        {options.map(([option, label]) => (
          <label key={option}>
            <input
              type="radio"
              name={name}
              checked={option === value}
              onChange={() => onChange(option)}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
