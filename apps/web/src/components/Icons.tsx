import type { ReactElement } from 'react';

const P: Record<string, ReactElement> = {
  board: <><rect x="3.5" y="4" width="7" height="16" rx="1.5" /><rect x="13.5" y="4" width="7" height="10" rx="1.5" /></>,
  inbox: <><path d="M21 12.5h-5.5l-1.8 2.5h-3.4l-1.8-2.5H3" /><path d="M5.8 5h12.4L21 12.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5.5z" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.6-3 3-5 6-5s5.4 2 6 5" /><path d="M15.5 5.3a3.2 3.2 0 0 1 0 6.4M17.5 14.7c1.7.6 3 2.3 3.4 4.8" /></>,
  bell: <><path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 7.5 2.5 7.5H4S6.5 15 6.5 9" /><path d="M10 19.5a2 2 0 0 0 4 0" /></>,
  shield: <path d="M12 3.5l7 2.8v5.4c0 4.4-3 7.6-7 8.8-4-1.2-7-4.4-7-8.8V6.3z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  hourglass: <path d="M7 3.5h10M7 20.5h10M8 3.5V7l4 5-4 5v3.5M16 3.5V7l-4 5 4 5v3.5" />,
  undo: <><path d="M9 14.5L4.5 10 9 5.5" /><path d="M4.5 10H15a5 5 0 0 1 0 10h-3" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v5h-5" /></>,
  archive: <><rect x="3.5" y="4.5" width="17" height="4" rx="1" /><path d="M5.5 8.5v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-10M10 12.5h4" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  xc: <><circle cx="12" cy="12" r="8.5" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  out: <><path d="M7 7l10 10" /><path d="M17 9v8H9" /></>,
  into: <><path d="M17 7L7 17" /><path d="M7 9v8h8" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  checks: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12l3 3 5-6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  dots: <><circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" /></>,
  car: <path d="M6 9l6 6 6-6" />,
  logout: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01" /></>,
  send: <><path d="M4 12l16-8-6 16-2.5-6.5z" /><path d="M11.5 13.5L20 4" /></>,
  move: <><path d="M5 12h14M15 8l4 4-4 4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></>,
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="1.5" /><path d="M8.5 20h7M12 16.5V20" /></>,
  sideClose: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9 4v16M15.5 9.5L13 12l2.5 2.5" /></>,
  sideOpen: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9 4v16M13 9.5l2.5 2.5-2.5 2.5" /></>,
  book: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" /></>,
  comment: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
};

export type IconName = keyof typeof P;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
