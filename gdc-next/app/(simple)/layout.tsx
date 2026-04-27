// (simple) layout — pass-through wrapper for pages that don't
// need the site header/footer. Each page in this group brings
// its own minimal layout (just a logo + content typically).
// Used for: privacy, contact, login, signup, password flows.

export default function SimpleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
