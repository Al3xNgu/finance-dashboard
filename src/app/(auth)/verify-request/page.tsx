import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Check your email",
};

export default function VerifyRequestPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm text-center">
        <div className="rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Check your email
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            A sign-in link has been sent to your email address. Click the link
            in the email to finish signing in.
          </p>
          <p className="mt-4 text-xs leading-5 text-zinc-400 dark:text-zinc-500">
            In development, the magic link is printed to the server console
            instead of being emailed.
          </p>
        </div>
      </div>
    </main>
  );
}
