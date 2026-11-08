// Inline SVG icons (stroke-based, 24×24). Kept in one file so the app has no
// icon-font or network dependency.

import { useId, type SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...p }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  );
}

export const IconBack = (p: P) => <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>;
export const IconChevron = (p: P) => <Svg {...p}><path d="M9 18l6-6-6-6" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconMinus = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const IconX = (p: P) => <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="M20 6L9 17l-5-5" /></Svg>;
export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);
export const IconTables = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Svg>
);
export const IconChart = (p: P) => <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Svg>;
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
    <path d="M16 2.5v4M8 2.5v4M3 10h18" />
  </Svg>
);
export const IconMic = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8" />
  </Svg>
);
export const IconSend = (p: P) => <Svg {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></Svg>;
export const IconSparkle = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8L12 3z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
  </Svg>
);
export const IconTrash = (p: P) => <Svg {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Svg>;
export const IconUndo = (p: P) => <Svg {...p}><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15-6.7L3 13" /></Svg>;
export const IconGrip = (p: P) => (
  <Svg {...p} strokeWidth={2.6}>
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
  </Svg>
);
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Svg>;
export const IconSplit = (p: P) => <Svg {...p}><path d="M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 22v-8" /></Svg>;
export const IconFile = (p: P) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M8 13h8M8 17h5" />
  </Svg>
);
export const IconPrinter = (p: P) => (
  <Svg {...p}>
    <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </Svg>
);
export const IconPencil = (p: P) => <Svg {...p}><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
export const IconShield = (p: P) => <Svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Svg>;
export const IconWifiOff = (p: P) => (
  <Svg {...p}>
    <path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.17-2.8M19 13a10 10 0 0 0-2.3-1.6M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M12 20h.01" />
  </Svg>
);
export const IconCash = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </Svg>
);

export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" />
  </Svg>
);
export const IconArrowDown = (p: P) => <Svg {...p}><path d="M12 5v14M19 12l-7 7-7-7" /></Svg>;
export const IconArrowUp = (p: P) => <Svg {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Svg>;
export const IconStop = (p: P) => <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /></Svg>;
export const IconPalette = (p: P) => (
  <Svg {...p}>
    <path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3.5-4 3.5h-1.7a1.8 1.8 0 0 0-1.3 3.1A1.9 1.9 0 0 1 12 22z" />
    <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
    <circle cx="11" cy="6.5" r="1" fill="currentColor" />
    <circle cx="16" cy="8" r="1" fill="currentColor" />
  </Svg>
);
export const IconVibrate = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="4" width="10" height="16" rx="2" />
    <path d="M3 9v6M21 9v6" />
  </Svg>
);
export const IconStore = (p: P) => (
  <Svg {...p}>
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    <path d="M5 11v9h14v-9M10 20v-5h4v5" />
  </Svg>
);
export const IconClock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IconBook = (p: P) => (
  <Svg {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
    <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
  </Svg>
);
export const IconDownload = (p: P) => <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></Svg>;
export const IconInfo = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></Svg>;
export const IconStar = (p: P) => <Svg {...p}><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></Svg>;
export const IconDoc = (p: P) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </Svg>
);
export const IconVolume = (p: P) => (
  <Svg {...p}>
    <path d="M11 5L6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </Svg>
);
export const IconRepeat = (p: P) => <Svg {...p}><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" /></Svg>;
export const IconBell = (p: P) => <Svg {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></Svg>;
export const IconReceipt = (p: P) => (
  <Svg {...p}>
    <path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z" />
    <path d="M9 7h6M9 11h6M9 15h4" />
  </Svg>
);
export const IconBowl = (p: P) => (
  <Svg {...p}>
    <path d="M3 11h18a9 7.5 0 0 1-18 0z" />
    <path d="M9 7c-1-1.3 1-2.2 0-3.6M12 7c-1-1.5 1-2.6 0-4M15 7c-1-1.3 1-2.2 0-3.6" />
  </Svg>
);
export const IconTable = (p: P) => <Svg {...p}><path d="M3 8h18M5 8v12M19 8v12M8 8V5h8v3" /></Svg>;

/** The app logo (same artwork as public/logo.svg). */
export function LogoMark({ size = 32, ...p }: P & { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true" {...p}>
      <defs>
        <linearGradient id={`bg${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F0614F" />
          <stop offset="1" stopColor="#B8312C" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#bg${id})`} />
      <g fill="none" stroke="#FFF6EA" strokeWidth="24" strokeLinecap="round" opacity="0.92">
        <path d="M196 214c-16-22 14-40 0-66" />
        <path d="M256 214c-16-26 14-46 0-80" />
        <path d="M316 214c-16-22 14-40 0-66" />
      </g>
      <path d="M120 262h272a136 128 0 0 1-272 0z" fill="#FBF3E8" />
      <rect x="104" y="244" width="304" height="30" rx="15" fill="#FFFBF4" />
      <rect x="150" y="290" width="212" height="16" rx="8" fill="#F2A93B" />
      <rect x="214" y="384" width="84" height="18" rx="9" fill="#F3E6D3" />
    </svg>
  );
}
