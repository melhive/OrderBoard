// Privacy Policy and Terms of Use shown in the app.
//
// BEFORE PUBLISHING: fill in PUBLISHER and CONTACT_EMAIL, have the text
// reviewed, and host the Privacy Policy at a public URL for the Play Store
// listing. Bump LEGAL_VERSION whenever the text changes materially; users
// are asked to accept again.

export const PUBLISHER = "Order Board";
export const CONTACT_EMAIL = "support@example.com"; // TODO: replace with your real support address
export const LEGAL_VERSION = "2026-11-08.2";
export const LEGAL_EFFECTIVE = "November 8, 2026";

export interface LegalSection {
  heading: string;
  body: string[];
}

export const PRIVACY: LegalSection[] = [
  {
    heading: "Summary",
    body: [
      "Order Board is an offline tool for running a food stall. Your orders, sales, menu and settings are stored only on this device. We do not run servers that receive your data, we do not require an account, and we do not show ads or use analytics or tracking.",
    ],
  },
  {
    heading: "Information stored on your device",
    body: [
      "Order and billing data: tables, items ordered, prices, split bills, cash received and change.",
      "Sales history: paid orders with their date, time, table and total.",
      "Menu and settings: your items, prices, item nicknames, business name, working hours, theme and assistant preferences.",
      "Assistant conversation: your recent messages with Ask Agent (up to 200) are saved on this device so you can scroll back through them. You can delete them at any time with “Clear chat” in Ask Agent.",
      "This information stays in your browser’s or the app’s private storage on this device. It is not sent to us or anyone else.",
    ],
  },
  {
    heading: "Ask Agent",
    body: [
      "Ask Agent understands typed requests entirely on your device. Typed messages are never sent over the internet.",
    ],
  },
  {
    heading: "Voice input",
    body: [
      "Voice input is optional and only starts when you tap the microphone. Order Board itself does not record or store audio.",
      "To turn speech into text, Order Board uses your device’s built-in speech recognition service. On many Android devices and in Chrome this service is provided by Google and may process your voice over the internet under Google’s own privacy policy. If you prefer not to use it, type your requests instead or turn voice off.",
      "Spoken replies use your device’s built-in text-to-speech voice.",
    ],
  },
  {
    heading: "Permissions",
    body: [
      "Microphone: only used for voice input while you are holding or have tapped the microphone button.",
      "Storage / files: only used when you choose to export a report or backup, or import a backup file.",
    ],
  },
  {
    heading: "Backups and exports",
    body: [
      "When you export a report or backup, the file is saved or shared where you choose (for example your Downloads folder, Google Drive or a messaging app). After that, the file is handled by the app or service you chose.",
    ],
  },
  {
    heading: "Data retention and deletion",
    body: [
      "Your data remains on the device until you delete it. You can remove individual sales in Summary, reset a day’s sales, or delete everything by clearing the app’s storage (Android Settings → Apps → Order Board → Storage → Clear data) or uninstalling the app. Uninstalling or clearing storage permanently deletes your data unless you have exported a backup.",
    ],
  },
  {
    heading: "Children",
    body: ["Order Board is a business tool and is not directed to children under 13."],
  },
  {
    heading: "Your rights",
    body: [
      "Because your data never leaves your device, you have direct control over it at all times: you can view, export, correct and delete it within the app. If you are in the Philippines, you also have rights under the Data Privacy Act of 2012 (Republic Act No. 10173).",
    ],
  },
  {
    heading: "Changes to this policy",
    body: ["If this policy changes, the app will show the updated version and ask you to review it."],
  },
  {
    heading: "Contact",
    body: [`Questions about privacy: ${CONTACT_EMAIL}`],
  },
];

export const TERMS: LegalSection[] = [
  {
    heading: "Agreement",
    body: [
      `By using Order Board you agree to these Terms. If you do not agree, please do not use the app. Order Board is provided by ${PUBLISHER}.`,
    ],
  },
  {
    heading: "What the app does",
    body: [
      "Order Board helps you take orders, keep running bills, record payments and review sales. It is a record-keeping aid, not an accounting, tax or point-of-sale certified system, and is not an official receipt or invoice issuer.",
    ],
  },
  {
    heading: "Your responsibilities",
    body: [
      "You are responsible for checking that orders, prices, totals and change are correct before relying on them, including entries made through Ask Agent or voice input.",
      "You are responsible for your own business records, tax obligations and compliance with local regulations, including issuing official receipts where required.",
      "Your data is stored only on your device. You are responsible for exporting backups regularly. Losing, resetting or uninstalling the app or device can permanently delete data that has not been backed up.",
    ],
  },
  {
    heading: "Ask Agent and voice",
    body: [
      "Ask Agent interprets your requests automatically and can make mistakes, especially with unclear speech or noisy surroundings. Payments, clearing bills and menu changes always ask for confirmation; please review them. Use Undo or edit the bill if something is wrong.",
    ],
  },
  {
    heading: "Acceptable use",
    body: ["Do not use the app for unlawful purposes or to create false business records."],
  },
  {
    heading: "No warranty",
    body: [
      "The app is provided “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy or uninterrupted operation.",
    ],
  },
  {
    heading: "Limitation of liability",
    body: [
      "To the maximum extent permitted by law, the provider is not liable for any indirect, incidental or consequential damages, or for loss of data, revenue or profits, arising from your use of the app.",
    ],
  },
  {
    heading: "Changes",
    body: ["We may update the app and these Terms. Continued use after an update means you accept the updated Terms."],
  },
  {
    heading: "Governing law",
    body: ["These Terms are governed by the laws of the Republic of the Philippines."],
  },
  {
    heading: "Contact",
    body: [`Questions about these Terms: ${CONTACT_EMAIL}`],
  },
];
