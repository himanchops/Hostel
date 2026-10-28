"use client";

import { useState } from "react";
import { Button, FormError, Modal, SegmentedControl, TOUCH_LINK, TOUCH_TARGET } from "@/components/ui";
import { HOUSE_RULES, SHEET_TEXT, type RulesLang } from "@/lib/houseRules";
import { formatDay } from "@/lib/api";

const LANGS = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिंदी" },
] as const;

function LanguageToggle({ lang, onChange }: { lang: RulesLang; onChange: (l: RulesLang) => void }) {
  return <SegmentedControl options={LANGS} value={lang} onChange={onChange} ariaLabel="Language" />;
}

/**
 * The rules of one version in one language. With `ticks`, every money rule
 * and the house rules as a whole get a checkbox; without, it only reads.
 *
 * The money rules are red because the owner wants them read, not skimmed:
 * they are the two that decide what comes back at move-out.
 */
function RulesBody({
  version,
  lang,
  ticks,
  onTick,
}: {
  version: string;
  lang: RulesLang;
  ticks?: boolean[];
  onTick?: (i: number, on: boolean) => void;
}) {
  const rules = HOUSE_RULES[version]?.[lang];
  const text = SHEET_TEXT[lang];
  if (!rules) return null;
  const houseTick = rules.money.length;

  return (
    <div lang={lang} className="space-y-4">
      <div className="space-y-2">
        {rules.money.map((rule, i) => {
          const body = (
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-red-800">{rule.title}</span>
              <span className="block text-sm text-red-700">{rule.detail}</span>
            </span>
          );
          return ticks ? (
            <label
              key={i}
              className={`${TOUCH_TARGET} flex cursor-pointer items-start gap-3 rounded-lg bg-red-50 p-3 ring-1 ring-red-200`}
            >
              <input
                type="checkbox"
                checked={ticks[i]}
                onChange={(e) => onTick?.(i, e.target.checked)}
                className="mt-0.5 h-5 w-5 flex-none accent-red-600"
              />
              {body}
            </label>
          ) : (
            <div key={i} className="rounded-lg bg-red-50 p-3 ring-1 ring-red-200">{body}</div>
          );
        })}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-stone-700">{text.houseHeading}</h3>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-stone-700">
          {rules.house.map((rule, i) => <li key={i}>{rule}</li>)}
        </ul>
        {ticks && (
          <label
            className={`${TOUCH_TARGET} mt-3 flex cursor-pointer items-center gap-3 rounded-lg bg-stone-50 p-3 text-sm font-medium text-stone-800 ring-1 ring-stone-100`}
          >
            <input
              type="checkbox"
              checked={ticks[houseTick]}
              onChange={(e) => onTick?.(houseTick, e.target.checked)}
              className="h-5 w-5 flex-none accent-indigo-600"
            />
            {text.agreeHouse}
          </label>
        )}
      </div>
    </div>
  );
}

/** How many ticks a version asks for: one per money rule, one for the rest. */
function tickCount(version: string): number {
  return (HOUSE_RULES[version]?.en.money.length ?? 0) + 1;
}

/**
 * What opens when someone taps "Submit registration": the rules, a tick for
 * each money rule and one for the house rules, and only then the button that
 * registers. The page starts uploading the photos as this opens, so the
 * reading covers the wait.
 *
 * Ticks and language are kept while the sheet is closed, so going back to
 * fix a field does not mean ticking everything again.
 */
export function HouseRulesSheet({
  open,
  version,
  onClose,
  onAgree,
  busy,
  uploads,
  error,
}: {
  open: boolean;
  version: string;
  onClose: () => void;
  onAgree: () => void;
  busy: boolean;
  uploads: "uploading" | "done" | "failed";
  error: string;
}) {
  const [lang, setLang] = useState<RulesLang>("en");
  const [ticks, setTicks] = useState<boolean[]>(() => Array(tickCount(version)).fill(false));
  const [missing, setMissing] = useState(false);
  const text = SHEET_TEXT[lang];

  function tick(i: number, on: boolean) {
    setTicks((t) => t.map((v, j) => (j === i ? on : v)));
    setMissing(false);
  }

  function agree() {
    // The button stays live and says what is left, rather than sitting
    // greyed out with no reason a phone can show.
    if (ticks.some((t) => !t)) {
      setMissing(true);
      return;
    }
    onAgree();
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={text.title}
      footer={
        <div className="w-full space-y-2">
          {missing && <p className="text-sm text-red-700" role="alert">{text.tickAll}</p>}
          <Button className="w-full" onClick={agree} loading={busy}>
            {busy ? text.agreeing : text.agree}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onClose} disabled={busy}>
            {text.back}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-stone-500" lang={lang}>{text.intro}</p>
          <div className="w-40 flex-none">
            <LanguageToggle lang={lang} onChange={setLang} />
          </div>
        </div>
        <RulesBody version={version} lang={lang} ticks={ticks} onTick={tick} />
        {uploads !== "done" && !error && (
          <p className="text-[13px] text-stone-500" lang={lang}>
            {uploads === "uploading" ? text.uploading : text.uploadFailed}
          </p>
        )}
        {error && <FormError>{error}</FormError>}
      </div>
    </Modal>
  );
}

/** The rules of one version, to read, with the same language switch. */
export function HouseRulesView({ version }: { version: string }) {
  const [lang, setLang] = useState<RulesLang>("en");
  return (
    <div className="space-y-4">
      <div className="w-40">
        <LanguageToggle lang={lang} onChange={setLang} />
      </div>
      <RulesBody version={version} lang={lang} />
    </div>
  );
}

/**
 * "Agreed 28 Oct 2026", which opens the very version they ticked. Nothing at
 * all for someone who never saw the form: the owner added them by hand, or
 * they registered before the rules existed.
 */
export function RulesAgreed({ version, agreedAt }: { version?: string; agreedAt?: string }) {
  const [open, setOpen] = useState(false);
  if (!version || !agreedAt || !HOUSE_RULES[version]) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">House rules</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${TOUCH_LINK} text-sm font-medium text-indigo-600 hover:underline`}
      >
        Agreed {formatDay(agreedAt)}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="House rules">
        <HouseRulesView version={version} />
      </Modal>
    </div>
  );
}
