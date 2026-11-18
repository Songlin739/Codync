import { DashboardView } from './DashboardView'
import './dashboard-window.css'

/**
 * The account-wide Dashboard as its own freely-movable window, opened alongside the chat window
 * (`main/index.ts`'s `openDashboard`) rather than as a Sheet overlay inside it — so the user can
 * keep an eye on every bot's status while working in the chat window beside it. Selecting a node
 * here brings the chat window forward with that bot open, since this window has no chat of its own.
 */
export function DashboardWindow() {
  return (
    <div className="dashboard-window">
      <DashboardView ownWindow />
    </div>
  )
}
