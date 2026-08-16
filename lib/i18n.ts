// Outbound SMS message catalog — English and standard French. Used by the
// Twilio webhook (app/api/twilio/inbound/route.ts) to reply in the sender's
// own preferredLanguage (Patient.preferredLanguage / Caregiver.preferredLanguage).
//
// Honest scope note: this is STANDARD French, not Louisiana Cajun French.
// Cajun French differs from standard French in vocabulary, some grammar,
// and pronunciation in ways a text-only channel can't fully capture, and
// verifying dialect-accurate phrasing was out of scope here — a native
// Cajun French speaker should review this copy before treating it as
// regionally authentic, not just grammatically correct French.

export type Lang = "en" | "fr";

export function normalizeLang(value: string | null | undefined): Lang {
  return value === "fr" ? "fr" : "en";
}

const MESSAGES = {
  ackRed: {
    en: "Thanks for the update. Based on what you shared, a nurse from your care team will call you shortly. If you're feeling very unwell, please don't wait — call your clinic or 911.",
    fr: "Merci pour votre message. D'après ce que vous avez partagé, une infirmière de votre équipe de soins vous appellera bientôt. Si vous vous sentez très mal, n'attendez pas — appelez votre clinique ou le 911.",
  },
  ackYellow: {
    en: "Thanks for the update — logged. Your care team is keeping an eye on your recent symptoms.",
    fr: "Merci pour votre message — c'est enregistré. Votre équipe de soins surveille vos symptômes récents.",
  },
  ackGreen: {
    en: "Thanks for checking in — logged. Feel better!",
    fr: "Merci de nous avoir donné des nouvelles — c'est enregistré. Bon rétablissement !",
  },
  genericLogged: {
    en: "Thanks for checking in — logged.",
    fr: "Merci de nous avoir donné des nouvelles — c'est enregistré.",
  },
  patientParseFailed: {
    en: 'Sorry, we couldn\'t understand that message. Please reply with your pain, nausea, and fatigue (0-10) and your temperature, e.g. "4,2,6,98.6".',
    fr: "Désolé, nous n'avons pas compris ce message. Veuillez répondre avec votre douleur, nausée et fatigue (0-10) et votre température, par exemple « 4,2,6,98.6 ».",
  },
  caregiverRelayPrefix: {
    en: "Thanks, logged on {{name}}'s behalf. ",
    fr: "Merci, enregistré au nom de {{name}}. ",
  },
  caregiverBurdenFlaggedStructured: {
    en: "Thank you for sharing — caregiving is hard. We've flagged this for your care team so they can check in on you too.",
    fr: "Merci de partager cela — être aidant est difficile. Nous avons signalé ceci à votre équipe de soins afin qu'elle prenne aussi de vos nouvelles.",
  },
  caregiverCopingLoggedStructured: {
    en: "Thanks for checking in on how you're doing — logged.",
    fr: "Merci de nous avoir donné des nouvelles de votre état — c'est enregistré.",
  },
  caregiverBurdenNote: {
    en: "We've also flagged this for your care team to check in on you.",
    fr: "Nous avons également signalé ceci à votre équipe de soins afin qu'elle prenne de vos nouvelles.",
  },
  clarifyingQuestion: {
    en: "Thanks for the message — we couldn't quite tell if that was about how the patient is doing or how you're doing. Could you say a bit more?",
    fr: "Merci pour votre message — nous n'avons pas bien compris s'il s'agissait de l'état du patient ou du vôtre. Pourriez-vous préciser un peu plus ?",
  },
  caregiverParseFailed: {
    en: "Sorry, we couldn't understand that message. Please try again.",
    fr: "Désolé, nous n'avons pas compris ce message. Veuillez réessayer.",
  },
  emptyBody: {
    en: 'We didn\'t get any text in that message — could you resend with how you\'re feeling, e.g. "4,2,6,98.6" or just describe it in your own words?',
    fr: "Nous n'avons reçu aucun texte dans ce message — pourriez-vous le renvoyer en indiquant comment vous vous sentez, par exemple « 4,2,6,98.6 », ou simplement le décrire avec vos propres mots ?",
  },
  unrecognizedNumber: {
    en: "This number isn't recognized by CareSignal. If you're a patient or caregiver, please contact your care team to get set up.",
    fr: "Ce numéro n'est pas reconnu par CareSignal. Si vous êtes un patient ou un aidant, veuillez contacter votre équipe de soins pour vous inscrire.",
  },
  genericFallback: {
    en: "Sorry, something went wrong logging that on our end — it wasn't saved. Please try texting again in a few minutes, or call your clinic if this is urgent.",
    fr: "Désolé, une erreur s'est produite de notre côté et ce message n'a pas été enregistré. Veuillez réessayer dans quelques minutes, ou appeler votre clinique si c'est urgent.",
  },
} as const;

export type MessageKey = keyof typeof MESSAGES;

export function t(key: MessageKey, lang: Lang, params?: Record<string, string>): string {
  const template = MESSAGES[key][lang] ?? MESSAGES[key].en;
  if (!params) return template;
  return Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template as string);
}
