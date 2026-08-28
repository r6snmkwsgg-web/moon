/** Ticker logo, falling back to a monogram tile when no logo_url is set. */
export default function LogoTile({
  symbol,
  logoUrl,
  size = 36,
}: {
  symbol: string;
  logoUrl: string | null;
  size?: number;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-md border border-terminal-line object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="flex shrink-0 items-center justify-center rounded-md border border-terminal-line bg-terminal-bg font-mono font-bold text-terminal-accent"
      aria-hidden="true"
    >
      {symbol.slice(0, 2)}
    </div>
  );
}
