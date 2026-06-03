import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { HardwareDashboard } from "@/components/hardware-dashboard"
import { ThemeProvider } from "@/components/theme-provider"

import "./globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <HardwareDashboard />
    </ThemeProvider>
  </StrictMode>
)
