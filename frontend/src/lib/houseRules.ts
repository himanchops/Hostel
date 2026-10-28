/**
 * The house rules someone agrees to before their registration goes through.
 *
 * Kept here rather than on the owner's Account page: there is one real owner,
 * and a rule change is a one-line PR (Oct 2026). If a second owner ever signs
 * up, each will want their own, and that is when these move into settings.
 *
 * Every version anyone has agreed to stays in HOUSE_RULES, word for word. A
 * tenant row stores only the version's label (migration 018), so editing an
 * old entry would silently change what someone agreed to. To change a rule,
 * add a new version, point HOUSE_RULES_VERSION at it, and move
 * `houseRulesVersion` in backend/internal/handlers/rules.go to match.
 *
 * The two money rules are the house rules the move-out sheet applies
 * (`moveOutSettlement`): rent is never refunded, and the deposit comes back
 * only with notice by the start of the last rent month. "A month before you
 * leave" is how the owner says that, and it never promises more than the
 * sheet gives: anyone who tells a month ahead is always on time.
 */

export type RulesLang = "en" | "hi";

export interface RulesText {
  /** Each its own tick, in red: these decide money at move-out. */
  money: { title: string; detail: string }[];
  /** One tick for all of them. */
  house: string[];
}

export const HOUSE_RULES: Record<string, Record<RulesLang, RulesText>> = {
  "2026-10-28": {
    en: {
      money: [
        {
          title: "Rent is not refundable",
          detail: "Rent you've paid is not returned, even if you leave early.",
        },
        {
          title: "One month's notice for your deposit",
          detail: "Tell us a month before you leave, or the deposit is kept.",
        },
      ],
      house: [
        "No smoking, alcohol or drugs anywhere in the hostel.",
        "Your belongings are your responsibility.",
        "Switch off the lights and fans when you leave your room, and keep it tidy.",
        "No cooking in rooms. Phones, laptops and chargers are fine; gas stoves, heaters, irons and kettles are not.",
      ],
    },
    hi: {
      money: [
        {
          title: "किराया वापस नहीं होगा",
          detail: "जो किराया आपने दे दिया है, वह वापस नहीं मिलेगा, चाहे आप जल्दी चले जाएँ।",
        },
        {
          title: "डिपॉज़िट के लिए एक महीने का नोटिस",
          detail: "जाने से एक महीने पहले बताएँ, वरना डिपॉज़िट वापस नहीं मिलेगा।",
        },
      ],
      house: [
        "हॉस्टल में कहीं भी सिगरेट, शराब या किसी भी तरह का नशा मना है।",
        "अपने सामान की ज़िम्मेदारी आपकी है।",
        "कमरे से निकलते समय लाइट और पंखे बंद करें, और कमरा साफ़ रखें।",
        "कमरे में खाना न बनाएँ। फ़ोन, लैपटॉप और चार्जर ठीक हैं; गैस चूल्हा, हीटर, प्रेस और केतली नहीं।",
      ],
    },
  },
};

/** The version the registration form shows today. */
export const HOUSE_RULES_VERSION = "2026-10-28";

/**
 * The words around the rules, which are not part of what anyone agrees to and
 * so are not versioned. The agree line is worded so it reads the same for a
 * man or a woman: "मैं पालन करूँगा" would only fit one of them.
 */
export const SHEET_TEXT: Record<RulesLang, {
  title: string;
  intro: string;
  houseHeading: string;
  agreeHouse: string;
  agree: string;
  agreeing: string;
  back: string;
  tickAll: string;
  uploading: string;
  uploadFailed: string;
}> = {
  en: {
    title: "Before you register",
    intro: "Read each one and tick it.",
    houseHeading: "House rules",
    agreeHouse: "I'll follow the house rules",
    agree: "Agree and register",
    agreeing: "Registering…",
    back: "Back to the form",
    tickAll: "Tick each one to go on.",
    uploading: "Your photos are uploading…",
    uploadFailed: "A photo didn't upload. Agreeing will try it again.",
  },
  hi: {
    title: "रजिस्टर करने से पहले",
    intro: "हर एक नियम पढ़ें और उस पर टिक करें।",
    houseHeading: "हॉस्टल के नियम",
    agreeHouse: "नियम पढ़ लिए, मंज़ूर हैं",
    agree: "मंज़ूर है, रजिस्टर करें",
    agreeing: "रजिस्टर हो रहा है…",
    back: "फ़ॉर्म पर वापस जाएँ",
    tickAll: "आगे बढ़ने के लिए हर एक पर टिक करें।",
    uploading: "आपकी फ़ोटो अपलोड हो रही हैं…",
    uploadFailed: "एक फ़ोटो अपलोड नहीं हुई। रजिस्टर करने पर फिर से कोशिश होगी।",
  },
};
