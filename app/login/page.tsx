import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm space-y-4 py-10">
      <h1 className="font-mono text-lg font-bold">Sign in</h1>
      <p className="text-sm text-terminal-muted">
        Magic link, no password. New accounts start with{" "}
        <span className="num font-mono text-terminal-text">$10,000</span> of
        play money.
      </p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
