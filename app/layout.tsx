import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "eMakato", template: "%s | eMakato" },
  description: "eMakato subscriber portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/portal-assets/images/favicon.png" />
        {['bootstrap.min.css', 'icons.min.css', 'app.min.css', 'custom.css'].map((file) => (
          <link key={file} rel="stylesheet" href={`/portal-assets/css/${file}`} precedence="portal" />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
