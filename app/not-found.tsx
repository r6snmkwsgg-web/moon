import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <div className="font-mono text-5xl font-bold text-terminal-line">404</div>
      <h1 className="text-lg font-bold">Delisted, or never listed.</h1>
      <p className="text-sm text-terminal-muted">
        Whatever ticker this was, it isn&apos;t trading here. The board has
        everything that is.
      </p>
      <Link href="/" className="btn-ghost text-sm">
        Back to the board →
      </Link>
    </div>
  );
}
