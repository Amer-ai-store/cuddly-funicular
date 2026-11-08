import React from "react";
import { ScrollViewStyleReset } from "expo-router/html";
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#F8F7F4" />
        <title>لُقطة — اختيارات ذكية، لحياة أسهل</title>
        <meta
          name="description"
          content="متجر عربي مع مساعد تسوق، اختيارات مميزة، مفضلة وسلة مشتريات. نسخة تجريبية للهاتف والويب."
        />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
