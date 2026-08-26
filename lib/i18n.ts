// Outbound SMS message catalog — English, standard French, and standard
// Spanish. Used by the Twilio webhook (app/api/twilio/inbound/route.ts) to
// reply in the sender's own preferredLanguage (Patient.preferredLanguage /
// Caregiver.preferredLanguage).
//
// Honest scope note: this is STANDARD French and STANDARD Spanish, not any
// regional dialect. Spanish in particular has meaningful regional variation
// (Mexican, Caribbean, Central American, etc.) in vocabulary and idiom that
// a single standard-Spanish translation doesn't capture — this uses
// generally-understood, dialect-neutral phrasing rather than targeting one
// region. Same caveat applies to French vs. Louisiana Cajun French.
// Verifying dialect-specific phrasing for either language was out of scope
// here — a native speaker of the relevant dialect should review this copy
// before it's treated as regionally authentic, not just grammatically correct.

export type Lang = "en" | "fr" | "es";

export function normalizeLang(value: string | null | undefined): Lang {
  if (value === "fr") return "fr";
  if (value === "es") return "es";
  return "en";
}

const MESSAGES = {
  // Deterministic safety bounce-back — fires immediately whenever the
  // rules-based Layer 1 engine (lib/risk.ts) sets RED (fever >=100.4°F,
  // severe pain/nausea >=8), from BOTH the structured and the freeform
  // parsing paths (see riskAckMessage() in
  // app/api/twilio/inbound/route.ts — once symptom values are known, from
  // either path, the RED determination and this message are 100%
  // rules-engine output, with no further LLM step that could be skipped by
  // a timeout or error). {{clinicPhone}} is resolved from
  // CLINIC_TRIAGE_PHONE (see .env.example) — never a real number
  // hardcoded here.
  ackRed: {
    en: "This requires prompt medical attention. Please call {{clinicPhone}} now, or call 911 if this feels like an emergency. A member of your care team has also been notified.",
    fr: "Cela nécessite une attention médicale rapide. Veuillez appeler le {{clinicPhone}} maintenant, ou le 911 en cas d'urgence. Un membre de votre équipe de soins a également été averti.",
    es: "Esto requiere atención médica pronta. Por favor llame al {{clinicPhone}} ahora, o al 911 si esto se siente como una emergencia. También se ha notificado a un miembro de su equipo de atención.",
  },
  // Fires from the deterministic crisis-language safety gate (lib/safetyGate.ts),
  // BEFORE any LLM parsing runs — not an AI-generated reply. Points to real,
  // existing national crisis resources (988 Suicide & Crisis Lifeline, 911)
  // rather than any clinical instruction. {{clinicPhone}} resolved the same
  // way as ackRed.
  safetyGate: {
    en: "If you are in immediate danger, please call 911 now. You can also call or text 988 (Suicide & Crisis Lifeline) any time. Your care team has been notified and {{clinicPhone}} is there for you too.",
    fr: "Si vous êtes en danger immédiat, appelez le 911 maintenant. Vous pouvez aussi appeler ou texter le 988 (ligne d'aide en cas de crise) à tout moment. Votre équipe de soins a été avertie, et le {{clinicPhone}} est aussi là pour vous.",
    es: "Si está en peligro inmediato, llame al 911 ahora. También puede llamar o enviar un mensaje de texto al 988 (Línea de Crisis y Suicidio) en cualquier momento. Se ha notificado a su equipo de atención, y el {{clinicPhone}} también está para usted.",
  },
  ackYellow: {
    en: "Thanks for the update — logged. Your care team is keeping an eye on your recent symptoms.",
    fr: "Merci pour votre message — c'est enregistré. Votre équipe de soins surveille vos symptômes récents.",
    es: "Gracias por su mensaje — quedó registrado. Su equipo de atención está observando sus síntomas recientes.",
  },
  ackGreen: {
    en: "Thanks for checking in — logged. Feel better!",
    fr: "Merci de nous avoir donné des nouvelles — c'est enregistré. Bon rétablissement !",
    es: "Gracias por avisarnos — quedó registrado. ¡Que se mejore!",
  },
  genericLogged: {
    en: "Thanks for checking in — logged.",
    fr: "Merci de nous avoir donné des nouvelles — c'est enregistré.",
    es: "Gracias por avisarnos — quedó registrado.",
  },
  // Category-specific acknowledgments (see lib/needCategory.ts) — used
  // ONLY for LOGISTICAL/EMOTIONAL/FINANCIAL/UNCERTAIN messages, so the
  // sender knows their actual message was understood, not just "logged"
  // as if it were a routine symptom check-in. CLINICAL and ROUTINE keep
  // using the existing risk-based ack* messages above, unchanged — this
  // never touches the safety-critical RED/YELLOW/GREEN pathway. No
  // internal terminology ("need category", "AI", "classified"), no
  // promise of a specific timeline this system can't guarantee.
  ackLogistical: {
    en: "Thanks for letting us know. I've flagged this for your care team so they can help.",
    fr: "Merci de nous en avoir informés. J'ai signalé ceci à votre équipe de soins pour qu'elle puisse vous aider.",
    es: "Gracias por avisarnos. He señalado esto a su equipo de atención para que puedan ayudarle.",
  },
  // Semifinal red-team fix: "has been notified" overstated what actually
  // happened at send time — an alert row is created, not confirmation a
  // human has seen it yet. Reworded to describe only what's true right now
  // (received, sent for review), plus a general emergency-call line since
  // this ack covers non-crisis emotional distress and shouldn't leave a
  // patient without a clear "if this is worse than that, here's what to
  // do" — the safety gate / crisisLanguageDetected layer (lib/safetyGate.ts,
  // lib/ai.ts) already intercepts actual crisis language before this
  // message would ever be sent.
  ackEmotional: {
    en: "Thank you for sharing that. Your message has been received and sent to your care team for review. If this is a medical emergency, call 911.",
    fr: "Merci de nous en avoir fait part. Votre message a été reçu et transmis à votre équipe de soins pour examen. En cas d'urgence médicale, appelez le 911.",
    es: "Gracias por compartir eso. Su mensaje ha sido recibido y enviado a su equipo de atención para revisión. Si es una emergencia médica, llame al 911.",
  },
  ackFinancial: {
    en: "Thanks for letting us know. I've flagged this for your care team so they can connect you with support.",
    fr: "Merci de nous en avoir informés. J'ai signalé ceci à votre équipe de soins afin qu'elle puisse vous mettre en contact avec de l'aide.",
    es: "Gracias por avisarnos. He señalado esto a su equipo de atención para que puedan conectarlo con apoyo.",
  },
  ackUncertain: {
    en: "Thanks for your message. I want to make sure we understand — a member of your care team will follow up with you directly.",
    fr: "Merci pour votre message. Je veux m'assurer que nous comprenons bien — un membre de votre équipe de soins vous contactera directement.",
    es: "Gracias por su mensaje. Quiero asegurarme de que entendemos bien — un miembro de su equipo de atención se comunicará con usted directamente.",
  },
  patientParseFailed: {
    en: 'Sorry, we couldn\'t understand that message. Please reply with your pain, nausea, and fatigue (0-10) and your temperature, e.g. "4,2,6,98.6".',
    fr: "Désolé, nous n'avons pas compris ce message. Veuillez répondre avec votre douleur, nausée et fatigue (0-10) et votre température, par exemple « 4,2,6,98.6 ».",
    es: 'Lo sentimos, no entendimos ese mensaje. Por favor responda con su dolor, náusea y fatiga (0-10) y su temperatura, por ejemplo "4,2,6,98.6".',
  },
  caregiverRelayPrefix: {
    en: "Thanks, logged on {{name}}'s behalf. ",
    fr: "Merci, enregistré au nom de {{name}}. ",
    es: "Gracias, registrado en nombre de {{name}}. ",
  },
  caregiverBurdenFlaggedStructured: {
    en: "Thank you for sharing — caregiving is hard. We've flagged this for your care team so they can check in on you too.",
    fr: "Merci de partager cela — être aidant est difficile. Nous avons signalé ceci à votre équipe de soins afin qu'elle prenne aussi de vos nouvelles.",
    es: "Gracias por compartir esto — cuidar a alguien es difícil. Hemos avisado a su equipo de atención para que también se comuniquen con usted.",
  },
  caregiverCopingLoggedStructured: {
    en: "Thanks for checking in on how you're doing — logged.",
    fr: "Merci de nous avoir donné des nouvelles de votre état — c'est enregistré.",
    es: "Gracias por contarnos cómo está usted — quedó registrado.",
  },
  caregiverBurdenNote: {
    en: "We've also flagged this for your care team to check in on you.",
    fr: "Nous avons également signalé ceci à votre équipe de soins afin qu'elle prenne de vos nouvelles.",
    es: "También hemos avisado a su equipo de atención para que se comuniquen con usted.",
  },
  clarifyingQuestion: {
    en: "Thanks for the message — we couldn't quite tell if that was about how the patient is doing or how you're doing. Could you say a bit more?",
    fr: "Merci pour votre message — nous n'avons pas bien compris s'il s'agissait de l'état du patient ou du vôtre. Pourriez-vous préciser un peu plus ?",
    es: "Gracias por su mensaje — no quedó claro si se trataba del estado del paciente o del suyo. ¿Podría contarnos un poco más?",
  },
  caregiverParseFailed: {
    en: "Sorry, we couldn't understand that message. Please try again.",
    fr: "Désolé, nous n'avons pas compris ce message. Veuillez réessayer.",
    es: "Lo sentimos, no entendimos ese mensaje. Por favor, inténtelo de nuevo.",
  },
  emptyBody: {
    en: 'We didn\'t get any text in that message — could you resend with how you\'re feeling, e.g. "4,2,6,98.6" or just describe it in your own words?',
    fr: "Nous n'avons reçu aucun texte dans ce message — pourriez-vous le renvoyer en indiquant comment vous vous sentez, par exemple « 4,2,6,98.6 », ou simplement le décrire avec vos propres mots ?",
    es: 'No recibimos ningún texto en ese mensaje — ¿podría reenviarlo indicando cómo se siente, por ejemplo "4,2,6,98.6", o simplemente describirlo con sus propias palabras?',
  },
  unrecognizedNumber: {
    en: "This number isn't recognized by CareSignal. If you're a patient or caregiver, please contact your care team to get set up.",
    fr: "Ce numéro n'est pas reconnu par CareSignal. Si vous êtes un patient ou un aidant, veuillez contacter votre équipe de soins pour vous inscrire.",
    es: "Este número no está registrado en CareSignal. Si usted es paciente o cuidador, comuníquese con su equipo de atención para inscribirse.",
  },
  genericFallback: {
    en: "Sorry, something went wrong logging that on our end — it wasn't saved. Please try texting again in a few minutes, or call your clinic if this is urgent.",
    fr: "Désolé, une erreur s'est produite de notre côté et ce message n'a pas été enregistré. Veuillez réessayer dans quelques minutes, ou appeler votre clinique si c'est urgent.",
    es: "Lo sentimos, ocurrió un error de nuestro lado y no se guardó el mensaje. Por favor intente enviarlo de nuevo en unos minutos, o llame a su clínica si es urgente.",
  },
} as const;

export type MessageKey = keyof typeof MESSAGES;

export function t(key: MessageKey, lang: Lang, params?: Record<string, string>): string {
  const template = MESSAGES[key][lang] ?? MESSAGES[key].en;
  if (!params) return template;
  return Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template as string);
}
