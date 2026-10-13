import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import { AdminProvider } from "@/components/lms/admin-lock";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

const SITE_NAME = "Lingo Ville LMS";
const SITE_DESCRIPTION =
  "Tablet-first attendance, student ledger, and payment tracking for language centers.";
const SITE_URL = "https://lingo-ville.com";
const OG_IMAGE = `${SITE_URL}/og-image.png`;
const THEME_COLOR = "#0F9589";

function NotFoundComponent() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        {/* "!" badge — bordered orange square with hard ink shadow */}
        <div
          aria-hidden="true"
          className="mx-auto mb-8 inline-flex size-20 items-center justify-center rounded-[22px] border border-foreground bg-brand-orange text-3xl font-bold text-foreground shadow-[5px_5px_0_var(--color-foreground)]"
        >
          !
        </div>

        <p
          aria-hidden="true"
          className="text-[clamp(5rem,16vw,9rem)] leading-[.82] font-bold tracking-[-0.06em] text-brand-orange"
        >
          404
        </p>

        <h1 className="mt-4 text-[clamp(1.8rem,4vw,2.8rem)] leading-[.95] font-bold tracking-[-0.05em] text-foreground">
          This page isn&rsquo;t on the roll call.
        </h1>

        <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
          The page you&rsquo;re looking for may have been moved, renamed, or never
          existed. Head back to the dashboard to keep going.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-foreground bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--color-foreground)]"
          >
            Back to Roll Call
          </a>
          <a
            href="https://lingo-ville.com"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-foreground bg-card px-6 py-3 text-sm font-bold text-foreground transition-transform hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--color-foreground)]"
          >
            Visit Lingo&nbsp;Ville ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-8 inline-flex size-20 items-center justify-center rounded-[22px] border border-foreground bg-destructive text-3xl font-bold text-destructive-foreground shadow-[5px_5px_0_var(--color-foreground)]"
        >
          !
        </div>

        <h1 className="text-[clamp(1.8rem,4vw,2.8rem)] leading-[.95] font-bold tracking-[-0.05em] text-foreground">
          This page didn&rsquo;t load.
        </h1>

        <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
          Something went wrong on our end. You can try refreshing, or head back to
          the dashboard.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-foreground bg-primary px-6 py-3 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--color-foreground)]"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-foreground bg-card px-6 py-3 text-sm font-bold text-foreground transition-transform hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--color-foreground)]"
          >
            Go to Roll Call
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "theme-color", content: THEME_COLOR },

      // Never index this app. It's an internal admin tool.
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "googlebot", content: "noindex, nofollow" },

      { title: SITE_NAME },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "author", content: "Ali Cheikh" },
      { name: "application-name", content: SITE_NAME },

      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:title", content: SITE_NAME },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: SITE_NAME },
      { property: "og:locale", content: "en_US" },

      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_NAME },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "canonical", href: SITE_URL },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AdminProvider>
        <Outlet />
        <Toaster position="top-center" richColors />
      </AdminProvider>
    </QueryClientProvider>
  );
}