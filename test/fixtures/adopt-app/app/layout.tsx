import "./globals.css"
import { Inter } from "next/font/google"
export const metadata = { title: "Fixture App", description: "A fixture used to test loom adopt." }
export default function RootLayout({ children }) { return <html><body>{children}</body></html> }
