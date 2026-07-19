import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { HardwareDashboard } from "@/components/hardware-dashboard"
import { CalibrationPage } from "@/components/calibration-page"
import { ThemeProvider } from "@/components/theme-provider"

import "./globals.css"

const page = window.location.pathname === "/calibration"
  ? <CalibrationPage />
  : <HardwareDashboard />

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      {page}
    </ThemeProvider>
  </StrictMode>
)
