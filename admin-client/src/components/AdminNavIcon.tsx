import type { SVGProps } from 'react';

const svgProps: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const AdminNavIcon = ({ name }: { name: string }) => {
  switch (name) {
    case 'dashboard':
      return (
        <svg {...svgProps}>
          <rect x="3" y="3" width="8" height="9" rx="1.5" />
          <rect x="13" y="3" width="8" height="5" rx="1.5" />
          <rect x="13" y="10" width="8" height="11" rx="1.5" />
          <rect x="3" y="14" width="8" height="7" rx="1.5" />
        </svg>
      );
    case 'users':
      return (
        <svg {...svgProps}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'withdrawals':
      return (
        <svg {...svgProps}>
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      );
    case 'deposits':
      return (
        <svg {...svgProps}>
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      );
    case 'game-config':
      return (
        <svg {...svgProps}>
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
      );
    case 'banks':
      return (
        <svg {...svgProps}>
          <path d="M3 21h18" />
          <path d="M3 10h18" />
          <path d="M5 6 12 3l7 3" />
          <path d="M6 10v11" />
          <path d="M10 10v11" />
          <path d="M14 10v11" />
          <path d="M18 10v11" />
        </svg>
      );
    case 'regex':
      return (
        <svg {...svgProps}>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case 'transfers':
      return (
        <svg {...svgProps}>
          <path d="M8 7h12" />
          <path d="m16 3 4 4-4 4" />
          <path d="M16 17H4" />
          <path d="m8 21-4-4 4-4" />
        </svg>
      );
    case 'referrals':
      return (
        <svg {...svgProps}>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4" />
          <path d="m8.6 10.5 6.8-4" />
        </svg>
      );
    case 'admin-credits':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v10" />
          <path d="M9.5 9.5c.6-1 1.6-1.5 2.5-1.5 1.7 0 2.5 1 2.5 2.2 0 2.3-4.5 1.4-4.5 4.3 0 1.2.9 2.2 2.6 2.2 1 0 1.9-.5 2.4-1.4" />
        </svg>
      );
    case 'coupons':
      return (
        <svg {...svgProps}>
          <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z" />
          <path d="M9 7v10" />
        </svg>
      );
    case 'winners':
      return (
        <svg {...svgProps}>
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
          <path d="M7 6H5a3 3 0 0 0 3 3" />
          <path d="M17 6h2a3 3 0 0 1-3 3" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...svgProps}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="m8 15 3-4 3 3 5-7" />
        </svg>
      );
    case 'admin-management':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
          <path d="M19 8h3" />
          <path d="M20.5 6.5v3" />
        </svg>
      );
    default:
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
};
